import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { syncSprintHealth } from '../../services/zohoSprints';
import { syncZohoProjects } from '../../services/zohoProjects';
import { getAccessToken } from '../../services/zohoAuth';
import { config } from '../../config';
import { touchLastSyncedAt } from '../../services/syncStatus';

const router = Router();

// GET /api/sprints — all stored sprint snapshots
router.get('/', async (_req, res) => {
  try {
    const sprints = await prisma.sprint.findMany({ orderBy: { projectName: 'asc' } });
    res.json({ sprints, total: sprints.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/sprints/debug/:projectId — probe Zoho sprints endpoint with various params
// Usage: curl http://localhost:3001/api/sprints/debug/22612000001241150
router.get('/debug/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    const cached = await prisma.settings.findUnique({ where: { key: 'zoho_team_id' } });
    const teamId = cached?.value;
    if (!teamId) { res.status(400).json({ error: 'Team ID not cached. Run user sync first.' }); return; }

    const token = getAccessToken();
    const base  = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectId}`;

    // 1. Fetch status map
    const statusRes = await axios.get(`${base}/itemstatus/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data' },
    }).catch(err => ({ data: { __error: err.response?.status, __msg: err.response?.data } }));
    const statusRaw = statusRes.data as Record<string, unknown>;
    const statusJObj = statusRaw?.statusJObj as Record<string, unknown[]> | undefined;
    const statusProp = (statusRaw?.status_prop as Record<string, number>) ?? {};
    const nameIdx = statusProp.statusName ?? 0;
    const typeIdx = statusProp.statusType ?? 4;
    const TYPE_MAP: Record<number, string> = { 0: 'todo', 2: 'doing', 1: 'done' };
    const statusMap: Record<string, string> = {};
    const statusGroupMap: Record<string, string> = {};
    if (statusJObj) {
      for (const [id, fields] of Object.entries(statusJObj)) {
        const name = String(fields[nameIdx] ?? 'Unknown').trim();
        const typeCode = typeof fields[typeIdx] === 'number' ? (fields[typeIdx] as number) : 0;
        statusMap[id] = name;
        statusGroupMap[name] = TYPE_MAP[typeCode] ?? 'todo';
      }
    }

    // 2. Fetch backlogId
    const backlogRes = await axios.get(`${base}/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'getbacklog' },
    }).catch(err => ({ data: { __error: err.response?.status, __msg: err.response?.data } }));
    const backlogId = (backlogRes.data as Record<string, unknown>)?.backlogId as string | undefined;

    // 3. Paginate ALL items from backlogId and collect per-status counts
    let backlogItems: { total: number; statusCounts: Record<string, number> } = { total: 0, statusCounts: {} };
    if (backlogId) {
      let index = 1;
      while (true) {
        const r = await axios.get(`${base}/sprints/${backlogId}/item/`, {
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
          params: { action: 'data', index, range: 100 },
        }).catch(() => null);
        if (!r) break;
        const raw = r.data as Record<string, unknown>;
        const itemIds: string[] = (raw?.itemIds as string[] | undefined) ?? [];
        const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;
        const itemProp = (raw?.item_prop as Record<string, number>) ?? {};
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        backlogItems.total += itemIds.length;
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            backlogItems.statusCounts[label] = (backlogItems.statusCounts[label] ?? 0) + 1;
          }
        }
        if (!raw?.next || itemIds.length < 100) break;
        index += 100;
      }
    }

    // 4. type=[7] gives kanbanBoardId — fetch items from it + probe project details for kanbanBoardId
    const kanbanType7Res = await axios.get(`${base}/sprints/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index: 1, range: 50, type: '[7]' },
    }).catch(err => ({ data: { __error: err.response?.status } }));
    const type7Raw = kanbanType7Res.data as Record<string, unknown>;
    const kanbanBoardId = ((type7Raw?.sprintIds as string[] | undefined) ?? [])[0];

    // Fetch items from kanbanBoardId (all pages)
    let boardItems: { total: number; statusCounts: Record<string, number> } = { total: 0, statusCounts: {} };
    if (kanbanBoardId) {
      let index = 1;
      while (true) {
        const r = await axios.get(`${base}/sprints/${kanbanBoardId}/item/`, {
          headers: { Authorization: `Zoho-oauthtoken ${token}` },
          params: { action: 'data', index, range: 100 },
        }).catch(() => null);
        if (!r) break;
        const raw = r.data as Record<string, unknown>;
        const itemIds: string[] = (raw?.itemIds as string[] | undefined) ?? [];
        const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;
        const itemProp = (raw?.item_prop as Record<string, number>) ?? {};
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        boardItems.total += itemIds.length;
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            boardItems.statusCounts[label] = (boardItems.statusCounts[label] ?? 0) + 1;
          }
        }
        if (!raw?.next || itemIds.length < 100) break;
        index += 100;
      }
    }

    res.json({
      projectId,
      statuses: statusGroupMap,
      backlogId,
      backlogItems,
      kanbanBoardId,
      boardItems,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/sprints/sync — fire-and-forget: start background sync, return current DB state immediately
router.post('/sync', async (_req, res) => {
  // Respond with current DB state immediately (avoids long-running HTTP request timeout)
  const sprints = await prisma.sprint.findMany({ orderBy: { projectName: 'asc' } });
  res.json({ synced: 0, sprints, status: 'started' });

  // Run full sync in background — rate limiter may take several minutes
  setImmediate(async () => {
    try {
      await syncZohoProjects();
      await syncSprintHealth();
      await touchLastSyncedAt();
      console.log('✅ Background sprint sync complete');
    } catch (err) {
      const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
      const message  = axios.isAxiosError(err)
        ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
        : (err instanceof Error ? err.message : 'Unknown error');
      console.error('❌ Sprint sync failed:', message);
    }
  });
});

export default router;
