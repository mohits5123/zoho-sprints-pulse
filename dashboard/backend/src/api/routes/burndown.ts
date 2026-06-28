/**
 * Burndown API - Fetch and seed burndown snapshot data for a sprint.
 *
 * Burndown snapshots track the total epic count and completed count over time.
 * The endpoint fetches historical snapshots from SQLite and optionally seeds today's
 * snapshot using live data provided by the caller (from epics collection in frontend).
 */

import { Router, Request } from 'express';
import { getBurndownSnapshots, recordBurndownSnapshot, type BurndownPoint } from '../../services/burndownSnapshots';

const router = Router({ mergeParams: true });

/**
 * GET /api/sprints/:sprintZohoId/burndown?doneCount=N&totalCount=N
 * @route GET /api/sprints/:sprintZohoId/burndown?doneCount=N&totalCount=N
 * @method GET
 * @param {string} sprintZohoId - The active sprint's zohoId (from URL)
 * @query doneCount (optional, required if seeding) - Count of epics marked as Done today. Seeding only occurs if doneCount is provided AND totalCount > 0.
 * @query totalCount (optional, required if seeding) - Total active epic count for this sprint today. Seeding only occurs if doneCount is provided AND totalCount > 0.
 * @returns {Object} - { snapshots: BurndownPoint[] } - Array of daily snapshot data sorted by date descending. Note: When seeding is performed, the snapshots array is modified in-place to include today's snapshot with the provided live data.
 * @returns {Object} - On error (HTTP 500), returns { error: string } with a descriptive error message.
 * @example
 * // Fetch existing burndown snapshots only
 * GET /api/sprints/sp_123/burndown
 * // Fetch snapshots + seed today's data with live counts from frontend epics collection
 * GET /api/sprints/sp_123/burndown?doneCount=5&totalCount=20
 */
router.get('/', async (req: Request<{ sprintZohoId: string }>, res) => {
  const { sprintZohoId } = req.params;
  const seedDone  = req.query['doneCount']  != null ? Number(req.query['doneCount'])  : null;
  const seedTotal = req.query['totalCount'] != null ? Number(req.query['totalCount']) : null;

  try {
    let snapshots: BurndownPoint[] = await getBurndownSnapshots(sprintZohoId);

    const today = new Date().toISOString().slice(0, 10);

    // Seed or correct today's snapshot using live counts from the caller.
    // Always upsert when seed values are provided so stale DB entries get fixed.
    // We filter out any existing entry for today before appending the fresh one
    // to avoid duplicates in the returned array. The final sort ensures the
    // snapshots are ordered chronologically (oldest → newest).
    if (seedDone !== null && seedTotal !== null && seedTotal > 0) {
      await recordBurndownSnapshot(sprintZohoId, seedDone, seedTotal);
      const todayEntry = { date: today, doneCount: seedDone, totalCount: seedTotal };
      snapshots = [
        ...snapshots.filter((s) => s.date !== today),
        todayEntry,
      ].sort((a, b) => a.date.localeCompare(b.date));
    }

    res.json({ snapshots });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Burndown fetch failed:', msg);
    res.status(500).json({ error: 'Failed to load burndown data' });
  }
});

export default router;
