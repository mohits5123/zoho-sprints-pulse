/**
 * Sprints API - Sprint management and health data.
 *
 * Endpoints for listing all stored sprint snapshots, syncing sprints from Zoho, and
 * debugging Sprint endpoint responses. The sync operation is fire-and-forget to avoid
 * long-running HTTP requests and return data to the caller immediately.
 */

import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { syncSprintHealth, fetchPastSprintNames, fetchPastSprintData, resolveTeamId } from '../../services/zohoSprints';
import { syncZohoProjects } from '../../services/zohoProjects';
import { getAccessToken } from '../../services/zohoAuth';
import { config } from '../../config';
import { touchLastSyncedAt } from '../../services/syncStatus';

const router = Router();

/**
 * GET /api/sprints — List all stored sprint snapshots.
 * @route GET /api/sprints
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - Sprint list with metadata
 *   { sprints: Sprint[], total: number }
 * @notes
 *   - Returns all sprints from SQLite (includes past, active, and future sprints)
 *   - Sprints are ordered by projectName ascending (alphabetical)
 *   - Data is populated during sync or manual refresh; not live from Zoho on each request
 * @auth Required (OAuth token validation)
 */
router.get('/', async (_req, res) => {
  try {
    const sprints = await prisma.sprint.findMany({ orderBy: { projectName: 'asc' } });
    res.json({ sprints, total: sprints.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Sprints list failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/sprints/debug/:projectId — Probe Zoho sprint endpoint with various params for debugging.
 * @route GET /api/sprints/debug/:projectId
 * @method GET
 * @params {string} projectId - The Zoho project ID to probe (e.g., "22612000001241150")
 * @returns {Object} - Debug data from Zoho API probing
 *   {
 *     projectId: string,
 *     statuses: Record<string, string> - Status name to statusGroupMap mapping (todo/doing/done)
 *     backlogId: string - The backlog's unique identifier (if exists), or undefined
 *     backlogItems: { total, statusCounts } - Total items in backlog + count per status
 *     kanbanBoardId: string | null - ID of the active sprint's board (type 7)
 *     boardItems: { total, statusCounts } - Items on the active sprint's kanban + counts
 *   }
 * @notes
 *   - Debug endpoint for troubleshooting Zoho API issues and understanding data structure
 *   - Requires zoho_team_id to be cached (run user sync first if missing)
 *   - Makes multiple paginated API calls to Zoho; can be slow for large projects
 * @errors 400 - Team ID not cached (run user sync first)
 *   500 - Zoho API error or timeout
 * @auth Required (OAuth token validation via getAccessToken())
 */
router.get('/debug/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    // Get cached team ID (required for API calls, stored during user sync)
    const cached = await prisma.settings.findUnique({ where: { key: 'zoho_team_id' } });
    const teamId = cached?.value;
    
    if (!teamId) { 
      res.status(400).json({ error: 'Team ID not cached. Run user sync first.' }); 
      return; 
    }

    const token = getAccessToken();
    const base  = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectId}`;

    // 1. Fetch status map via /itemstatus/
    const statusRes = await axios.get(`${base}/itemstatus/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data' },
    }).catch(err => ({ data: { __error: err.response?.status, __msg: err.response?.data } }));
    
    const statusRaw = statusRes.data as Record<string, unknown>;
    const statusJObj = statusRaw?.statusJObj as Record<string, unknown[]> | undefined;
    const statusProp = (statusRaw?.status_prop as Record<string, number>) ?? {};
    
    // Status index: name=0, type=4 (or use fallbacks)
    const nameIdx = statusProp.statusName ?? 0;
    const typeIdx = statusProp.statusType ?? 4;
    
    // Zoho status types: 0=todo, 2=doing (in_progress), 1=done
    const TYPE_MAP: Record<number, string> = { 0: 'todo', 2: 'doing', 1: 'done' };
    
    const statusMap: Record<string, string> = {};   // status ID -> human-readable name
    const statusGroupMap: Record<string, string> = {}; // status ID -> bucket (todo/doing/done)
    
    if (statusJObj) {
      for (const [id, fields] of Object.entries(statusJObj)) {
        const name = String(fields[nameIdx] ?? 'Unknown').trim();
        const typeCode = typeof fields[typeIdx] === 'number' ? (fields[typeIdx] as number) : 0;
        statusMap[id] = name;
        // Map to bucket based on type code (or default to todo)
        statusGroupMap[name] = TYPE_MAP[typeCode] ?? 'todo';
      }
    }

    // 2. Fetch backlogId via / with action=getbacklog
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
        
        // Status index from item properties (fallback chain)
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        
        backlogItems.total += itemIds.length;
        
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            
            // Get raw status field value (or -1 for unassigned if no status)
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            
            backlogItems.statusCounts[label] = (backlogItems.statusCounts[label] ?? 0) + 1;
          }
        }
        
        // Stop if no more pages or last page has fewer than 100 items
        if (!raw?.next || itemIds.length < 100) break;
        index += 100;
      }
    }

    // 4. type=[7] gives kanbanBoardId — fetch items from it + probe project details for kanbanBoardId
    // Type 7 represents a Sprint in Zoho's schema
    const kanbanType7Res = await axios.get(`${base}/sprints/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index: 1, range: 50, type: '[7]' },
    }).catch(err => ({ data: { __error: err.response?.status } }));
    
    const type7Raw = kanbanType7Res.data as Record<string, unknown>;
    // sprintIds array contains the IDs of active sprints; take the first one as kanbanBoardId
    const kanbanBoardId = ((type7Raw?.sprintIds as string[] | undefined) ?? [])[0];

    // Fetch items from kanbanBoardId (all pages, same pagination logic as backlog)
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
        
        // Same status index logic as backlog items
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        
        boardItems.total += itemIds.length;
        
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            
            // Get raw status field value (or -1 for unassigned if no status)
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            
            boardItems.statusCounts[label] = (boardItems.statusCounts[label] ?? 0) + 1;
          }
        }
        
        // Stop if no more pages or last page has fewer than 100 items
        if (!raw?.next || itemIds.length < 100) break;
        index += 100;
      }
    }

    res.json({
      projectId,
      statuses: statusGroupMap,   // Map of status ID -> bucket (todo/doing/done)
      backlogId,                  // Backlog's unique identifier for pagination access
      backlogItems,               // Items in the entire backlog (all statuses)
      kanbanBoardId,              // Active sprint's board ID for kanban view
      boardItems,                 // Items in the active sprint (kanban) only
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Debug endpoint failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/sprints/sync — Fire-and-forget sprint sync.
 * @route POST /api/sprints/sync
 * @method POST
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from session)
 * @returns {Object} - Immediate response with current sprint list, sync runs in background
 *   { synced: 0, sprints: Sprint[], status: 'started' }
 * @notes
 *   - Idempotent: Uses upsert pattern with unique zohoId key (from Zoho)
 *   - Responds IMMEDIATELY with current DB state to avoid timeout
 *   - Full sync (projects + sprints) runs in BACKGROUND via setImmediate
 *   - Respects rate limiter (25 req/min); large teams may take several minutes for full sync
 *   - Background sync is fire-and-forget; errors are logged but don't block the response
 * @auth Required (OAuth token validation via syncZohoProjects())
 */
router.post('/sync', async (_req, res) => {
  // Respond with current DB state immediately (avoids long-running HTTP request timeout)
  const sprints = await prisma.sprint.findMany({ orderBy: { projectName: 'asc' } });
  res.json({ synced: 0, sprints, status: 'started' });

  // Run full sync in background — rate limiter may take several minutes
  setImmediate(async () => {
    try {
      await syncZohoProjects();   // Sync project list first (sprints reference projects)
      await syncSprintHealth();    // Then sync all sprint data
      await touchLastSyncedAt();   // Update last sync timestamp in settings
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

/**
 * POST /api/sprints/fetch-past — Fetch past (completed) sprints for a project.
 * @route POST /api/sprints/fetch-past
 * @method POST
 * @headers Content-Type: application/json
 * @body { projectZohoId: string, sprintZohoId?: string }
 *   - If sprintZohoId is omitted: returns list of past sprint names/IDs only
 *   - If sprintZohoId is provided: fetches full data (issues, burndown) for that sprint
 * @returns { Object }
 *   - List mode: { sprints: SprintRaw[] } — sprint metadata only
 *   - Data mode: { sprint: SprintSnapshot } — fully synced sprint with issues
 * @notes
 *   - Two-step flow: first fetch names, then fetch full data per sprint
 *   - Issues for past sprints are upserted (NOT deleted like regular sync)
 *   - Burndown snapshots are recorded for each fetched sprint
 *   - User-triggered only, not part of regular sync
 * @auth Required (OAuth token validation)
 */
router.post('/fetch-past', async (req, res) => {
  try {
    const body = req.body as { projectZohoId: string; sprintZohoId?: string };
    
    if (!body.projectZohoId) {
      res.status(400).json({ error: 'projectZohoId is required' });
      return;
    }

    const teamId = await resolveTeamId();

    // If sprintZohoId is provided, fetch full data for that specific sprint
    if (body.sprintZohoId) {
      const sprintMeta = await fetchPastSprintNames(teamId, body.projectZohoId);
      const target = sprintMeta.find(s => s.zohoId === body.sprintZohoId);
      if (!target) {
        res.status(404).json({ error: `Sprint ${body.sprintZohoId} not found` });
        return;
      }
      const synced = await fetchPastSprintData(teamId, body.projectZohoId, target);
      res.json({ sprint: synced });
      return;
    }

    // Otherwise, return list of past sprint names only (no issues/burndown)
    const sprintNames = await fetchPastSprintNames(teamId, body.projectZohoId);
    res.json({ sprints: sprintNames });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Fetch past sprints failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
