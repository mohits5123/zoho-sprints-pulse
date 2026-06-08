/**
 * Sync Status API - Returns the timestamp of the last successful data sync.
 *
 * The lastSyncedAt timestamp is updated during:
 * - Cron job execution (every 3 hours)
 * - Manual sync via POST /api/sprints/sync or POST /api/projects/sync
 */

import { Router } from 'express';
import { getLastSyncedAt } from '../../services/syncStatus';

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
    const lastSyncedAt = await getLastSyncedAt();
    res.json({ lastSyncedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Sync status read failed:', msg);
    res.status(500).json({ error: 'Failed to read sync status' });
  }
});

export default router;
