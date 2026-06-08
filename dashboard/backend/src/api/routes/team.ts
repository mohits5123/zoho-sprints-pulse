/**
 * Team Load API - Aggregate workload metrics across all active sprints.
 *
 * Aggregates WIP (Work In Progress) and stale issue counts per user from ALL active
 * sprints in the system. This differs from sprint-specific endpoints which report
 * metrics for a single sprint only.
 */

import { Router } from 'express';
import { queryTeamLoad } from '../../services/issueQueries';

const router = Router();

/**
 * GET /api/team/load — Get aggregate workload metrics for all users.
 * @route GET /api/team/load?staleDays=N (optional)
 * @method GET
 * @headers Content-Type: application/json
 * @query staleDays (optional) - Days since last update to consider an issue stale (default: 7, min: 1)
 * @returns {Object} - Aggregate team load metrics across all active sprints
 *   {
 *     users: Array<{ id, name, role, todo, doing, done, stale }> - Per-user breakdown
 *     sprintCount: number - Total active sprints across all projects
 *     projectCount: number - Total unique projects tracked
 *     staleDays: number - Used staleness threshold for this query
 *   }
 * @example
 * // Get team load with default staleness threshold (7 days)
 * GET /api/team/load
 * // Get team load with custom staleness threshold (14 days)
 * GET /api/team/load?staleDays=14
 */
router.get('/load', async (req, res) => {
  try {
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const { users, sprintCount, projectCount } = await queryTeamLoad(staleDays);
    res.json({ users, sprintCount, projectCount, staleDays });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ team/load failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
