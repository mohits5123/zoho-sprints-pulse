/**
 * Sync Status API - Returns the timestamp of the last successful data sync.
 *
 * The lastSyncedAt timestamp is updated during:
 * - Cron job execution (every 3 hours)
 * - Manual sync via POST /api/sprints/sync or POST /api/projects/sync
 */

import { Router } from 'express';
import { getLastSyncedAt, getSyncProgress } from '../../services/syncStatus';

const router = Router();

/**
 * GET /api/sync/status — Returns last successful sync timestamp.
 * @route GET /api/sync/status
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { lastSyncedAt?: Date | null }
 * @example
 * // Get timestamp of last successful sync (null if never synced)
 * GET /api/sync/status
 */
router.get('/', async (_req, res) => {
  try {
    // Returns null when the system has never completed a sync
    const lastSyncedAt = await getLastSyncedAt();
    res.json({ lastSyncedAt });
  } catch (err) {
    // Guard against non-Error objects thrown via `throw 'string'`
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Sync status read failed:', msg);
    res.status(500).json({ error: 'Failed to read sync status' });
  }
});

/**
 * GET /api/sync/progress — Returns real-time sync progress.
 * @route GET /api/sync/progress
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { inProgress, percentage, requestsMade, totalRequests, isFirstSync }
 * @example
 * // Get current sync progress
 * GET /api/sync/progress
 */
router.get('/progress', async (_req, res) => {
  try {
    // Returns snapshot of current in-progress sync or idle state if no sync is running
    const progress = await getSyncProgress();
    res.json(progress);
  } catch (err) {
    // Guard against non-Error objects thrown via `throw 'string'`
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Sync progress read failed:', msg);
    res.status(500).json({ error: 'Failed to read sync progress' });
  }
});

export default router;
