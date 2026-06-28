/**
 * Sprints API — Sprint management and health data.
 *
 * Provides endpoints for listing stored sprint snapshots, syncing sprints from Zoho
 * Projects, fetching historical sprint data, and debugging Zoho API responses.
 *
 * Architecture notes:
 *   - All sprint data is cached in SQLite; endpoints read from the local DB, not live Zoho.
 *   - Sync operations are fire-and-forget: the API responds immediately and the full sync
 *     runs asynchronously via `setImmediate` to avoid HTTP timeout (Zoho rate limit: 25 req/min).
 *   - The `hidden` flag on sprints is client-managed only and never overwritten by sync.
 *
 * Dependencies:
 *   - `../../services/zohoSprints` — core sync logic (runFullSync, fetchPastSprintNames/Data)
 *   - `../../services/zohoAuth`     — OAuth token management
 *   - `../../db/client`             — Prisma client for SQLite persistence
 */

import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { runFullSync, fetchPastSprintNames, fetchPastSprintData, resolveTeamId } from '../../services/zohoSprints';
import { getAccessToken } from '../../services/zohoAuth';
import { config } from '../../config';

const router = Router();

/**
 * GET /api/sprints — List all stored sprint snapshots.
 *
 * Returns every sprint record currently persisted in the local SQLite database,
 * regardless of sprint state (past, active, or future). Data is only refreshed
 * when a sync endpoint is called — this endpoint never queries Zoho directly.
 *
 * @route GET /api/sprints
 * @method GET
 * @returns {Object} Response object
 *   @property {Sprint[]} sprints  — All sprint records, sorted alphabetically by project name
 *   @property {number}   total    — Total count of sprint records
 * @errors 500 — Database read failure
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
 *
 * Makes a series of sequential API calls to Zoho to inspect the raw data structure
 * for a given project. Useful for diagnosing sync issues or understanding how Zoho
 * organizes items across backlog and active sprint boards.
 *
 * The endpoint performs four independent probes:
 *   1. Fetches the status map (name → bucket: todo/doing/done) via `/itemstatus/`
 *   2. Retrieves the backlog ID via the project root with `action=getbacklog`
 *   3. Paginates ALL backlog items and aggregates per-status counts
 *   4. Fetches the active sprint's kanban board (type 7) and its item counts
 *
 * @route GET /api/sprints/debug/:projectId
 * @method GET
 * @param {string} projectId — The Zoho project ID to probe (e.g., `"22612000001241150"`)
 * @returns {Object} Debug response
 *   @property {Record<string, string>} statuses      — Status ID → bucket mapping (todo/doing/done)
 *   @property {string|undefined}       backlogId      — Backlog's unique identifier for pagination
 *   @property {Object}                 backlogItems   — Aggregated backlog item stats
 *     @property {number} total           — Total items across all statuses
 *     @property {Record<string, number>} statusCounts — Items grouped by status label
 *   @property {string|null}            kanbanBoardId  — Active sprint (type 7) board ID
 *   @property {Object}                 boardItems     — Kanban board item stats (same shape as backlogItems)
 * @errors 400 — Team ID not cached; run user sync first
 *         500 — Zoho API error or timeout
 * @notes
 *   - Requires `zoho_team_id` to be cached (populated during user sync).
 *   - Makes multiple paginated API calls; may be slow for large projects with many items.
 *   - Each page fetches up to 100 items; pagination continues until no more pages remain.
 *   - Zoho status type codes: `0` = todo, `2` = doing (in_progress), `1` = done.
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
    // Zoho returns status data as an array-of-arrays; status_prop maps column names to array indices.
    const statusRes = await axios.get(`${base}/itemstatus/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data' },
    }).catch(err => ({ data: { __error: err.response?.status, __msg: err.response?.data } }));
    
    const statusRaw = statusRes.data as Record<string, unknown>;
    const statusJObj = statusRaw?.statusJObj as Record<string, unknown[]> | undefined;
    const statusProp = (statusRaw?.status_prop as Record<string, number>) ?? {};
    
    // status_prop maps field names to their column index in the statusJObj arrays.
    // Defaults: name at index 0, type at index 4 (Zoho's standard layout).
    const nameIdx = statusProp.statusName ?? 0;
    const typeIdx = statusProp.statusType ?? 4;
    
    // Zoho status type codes: 0=todo, 2=doing (in_progress), 1=done.
    // This maps the numeric type to a human-readable bucket for aggregation.
    const TYPE_MAP: Record<number, string> = { 0: 'todo', 2: 'doing', 1: 'done' };
    
    const statusMap: Record<string, string> = {};                 // status ID → human-readable name
    const statusGroupMap: Record<string, string> = {};            // status ID → bucket (todo/doing/done)
    
    if (statusJObj) {
      for (const [id, fields] of Object.entries(statusJObj)) {
        const name = String(fields[nameIdx] ?? 'Unknown').trim();
        const typeCode = typeof fields[typeIdx] === 'number' ? (fields[typeIdx] as number) : 0;
        statusMap[id] = name;
        // Map to bucket based on type code; default to 'todo' if type is unrecognized.
        statusGroupMap[name] = TYPE_MAP[typeCode] ?? 'todo';
      }
    }

    // 2. Fetch backlogId via / with action=getbacklog
    // The backlog ID is required to paginate all items within the project.
    const backlogRes = await axios.get(`${base}/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'getbacklog' },
    }).catch(err => ({ data: { __error: err.response?.status, __msg: err.response?.data } }));
    
    const backlogId = (backlogRes.data as Record<string, unknown>)?.backlogId as string | undefined;

    // 3. Paginate ALL items from backlogId and collect per-status counts.
    // Zoho paginates in pages of up to 100 items; we iterate until `next` is absent
    // or the page contains fewer than 100 items (indicating the last page).
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
        
        // Status index from item properties, with a fallback chain because Zoho's
        // API schema may use different field names across project versions.
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        
        backlogItems.total += itemIds.length;
        
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            
            // Resolve the status label using the map built in step 1.
            // If statusIdx < 0 the item has no status assigned; use empty string.
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            
            backlogItems.statusCounts[label] = (backlogItems.statusCounts[label] ?? 0) + 1;
          }
        }
        
        // Stop if no more pages or last page has fewer than 100 items.
        if (!raw?.next || itemIds.length < 100) break;
        index += 100;
      }
    }

    // 4. Fetch the active sprint's kanban board (type 7 in Zoho's schema) and its items.
    // Zoho uses numeric type codes; 7 specifically denotes a Sprint entity.
    const kanbanType7Res = await axios.get(`${base}/sprints/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index: 1, range: 50, type: '[7]' },
    }).catch(err => ({ data: { __error: err.response?.status } }));
    
    const type7Raw = kanbanType7Res.data as Record<string, unknown>;
    // sprintIds contains IDs of all type-7 sprints; we take the first (most recent/active).
    const kanbanBoardId = ((type7Raw?.sprintIds as string[] | undefined) ?? [])[0];

    // Fetch items from the kanban board using the same pagination logic as backlog items.
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
        
        // Reuse the same status index resolution as backlog (with fallback chain).
        const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
        
        boardItems.total += itemIds.length;
        
        if (itemJObj) {
          for (const id of itemIds) {
            const f = itemJObj[id];
            if (!f) continue;
            
            // Resolve status label; items without a status get an empty string label.
            const rawStatus = statusIdx >= 0 ? String(f[statusIdx]) : '';
            const label = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
            
            boardItems.statusCounts[label] = (boardItems.statusCounts[label] ?? 0) + 1;
          }
        }
        
        // Stop if no more pages or last page has fewer than 100 items.
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
 *
 * Triggers a full synchronization of projects and sprints from Zoho Projects into the
 * local SQLite database. The API responds **immediately** with the current database state
 * while the actual sync runs asynchronously in the background.
 *
 * Sync behaviour:
 *   - **Idempotent**: Uses upsert with the unique `zohoId` from Zoho; no duplicate records.
 *   - **Background execution**: `runFullSync()` is dispatched via `setImmediate` so the
 *     HTTP response is never delayed, even though full sync may take several minutes.
 *   - **Rate-limited**: Zoho enforces 25 requests/minute; large teams will take longer.
 *   - **Error isolation**: Failures in the background sync are logged but do not affect
 *     the immediate response or require client retry.
 *
 * @route POST /api/sprints/sync
 * @method POST
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from session)
 * @returns {Object} Immediate response
 *   @property {number}   synced   — Always `0` (sync hasn't completed yet at response time)
 *   @property {Sprint[]} sprints  — Current snapshot from the database
 *   @property {string}   status   — Always `'started'`
 * @errors 500 — Unexpected server error (unlikely; sync runs in background)
 * @auth Required (OAuth token validation via `runFullSync()`)
 */
router.post('/sync', async (_req, res) => {
  // Respond with current DB state immediately (avoids long-running HTTP request timeout)
  const sprints = await prisma.sprint.findMany({ orderBy: { projectName: 'asc' } });
  res.json({ synced: 0, sprints, status: 'started' });

  // Run full sync (projects + sprints) in background — rate limiter may take several minutes
  setImmediate(async () => {
    try {
      await runFullSync();
      console.log('✅ Background full sync complete');
    } catch (err) {
      const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
      const message  = axios.isAxiosError(err)
        ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
        : (err instanceof Error ? err.message : 'Unknown error');
      console.error('❌ Full sync failed:', message);
    }
  });
});

/**
 * POST /api/sprints/fetch-past — Fetch past (completed) sprints for a project.
 *
 * Supports a two-step flow for retrieving historical sprint data:
 *   1. **List mode** (no `sprintZohoId`): returns metadata for all past sprints.
 *   2. **Data mode** (`sprintZohoId` provided): fetches full issue data and burndown
 *      snapshots for a specific sprint.
 *
 * Unlike the regular sync endpoint, past-sprint issues are **upserted** (never deleted),
 * ensuring historical data persists across syncs.
 *
 * @route POST /api/sprints/fetch-past
 * @method POST
 * @headers Content-Type: application/json
 * @body { projectZohoId: string, sprintZohoId?: string }
 *   @property {string} projectZohoId  — Required. Zoho project identifier.
 *   @property {string} [sprintZohoId] — Optional. If omitted, returns list mode.
 * @returns {Object} Response depends on mode
 *   - **List mode** (`sprintZohoId` omitted):
 *     @property {SprintRaw[]} sprints — Sprint metadata (name, zohoId, dates) only.
 *   - **Data mode** (`sprintZohoId` provided):
 *     @property {SprintSnapshot} sprint — Full sprint with issues and burndown data.
 * @errors 400 — Missing projectZohoId
 *         404 — Specified sprintZohoId not found in the project's past sprints
 *         500 — Zoho API or database error
 * @notes
 *   - User-triggered only; not part of the automatic background sync cycle.
 *   - Burndown snapshots are recorded for each fetched sprint.
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

/**
 * PATCH /api/sprints/:id/display — Toggle the hidden flag for a sprint.
 *
 * Updates the `hidden` field on a sprint record. This flag controls whether the sprint
 * appears in the sprint health view on the frontend. It is a **client-managed** field —
 * it is never overwritten by Zoho sync operations and persists across syncs.
 *
 * @route PATCH /api/sprints/:id/display
 * @method PATCH
 * @param {string} id — The sprint's `zohoId` (used as the primary key in SQLite).
 * @body { hidden: boolean }
 *   @property {boolean} hidden — `true` to hide, `false` to show.
 * @returns {Object}
 *   @property {Sprint} sprint — The updated sprint record.
 * @errors 500 — Database update failure
 * @auth Required (OAuth token validation)
 */
router.patch('/:id/display', async (req, res) => {
  try {
    const { id } = req.params;
    const { hidden } = req.body as { hidden?: boolean };

    const data: { hidden?: boolean } = {};
    if (hidden !== undefined) data.hidden = hidden;

    const sprint = await prisma.sprint.update({ where: { zohoId: id }, data });
    res.json({ sprint });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Display settings update failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
