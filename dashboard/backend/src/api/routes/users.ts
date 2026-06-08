/**
 * User API - Manage users and fetch per-user metrics.
 *
 * Endpoints for user listing, profile data (issues raised/owned), sprint history,
 * and sync operations. User role labels are local-only and not synced from Zoho.
 */

import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { fetchZohoUsers } from '../../services/zohoUsers';
import { queryUserIssues, queryUserSprintHistory } from '../../services/issueQueries';

const router = Router();

/**
 * Valid role labels for team members. Set manually via UI (not from Zoho).
 */
const VALID_ROLES = ['DEV', 'QA', 'PROD', 'OTHER'] as const;
type Role = (typeof VALID_ROLES)[number];

/**
 * GET /api/users — List all locally stored users.
 * @route GET /api/users
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { users: User[], total: number }
 * @auth Required (OAuth token validation)
 */
router.get('/', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    res.json({ users, total: users.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Users list failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/users/:id/profile — Cross-sprint issue summary for one developer.
 * @route GET /api/users/:id/profile?staleDays=N (optional)
 * @method GET
 * @param {string} id - User's primary DB id (not zohoId)
 * @query staleDays (optional, default: 7, min: 1) - Days since last update to consider issue stale
 * @returns {Object} - User profile with issue metrics across all active sprints
 *   {
 *     user: { id, zohoId, name, email, role },
 *     issues: Array<Issue> - All issues created by this user (across all active sprints)
 *     raisedIssues: Issue[] - Filtered issues where this user is the creator
 *     summary: { total, todo, doing, done, stale, overdue, collab, raised } - Aggregate counts
 *     sprintCount: number - Total active sprints in system
 *     staleDays: number - Used staleness threshold for this query
 *   }
 * @notes
 *   - Single DB query, no Zoho calls per request (uses cached SQLite data)
 *   - Issues are filtered to only active sprints via queryUserIssues()
 *   - Creators != assignees; creator is who raised the ticket, not necessarily who's working on it
 * @auth Required (OAuth token validation)
 */
router.get('/:id/profile', async (req, res) => {
  try {
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });

    // Single DB query — no Zoho calls
    const allIssues = await queryUserIssues(user.zohoId, staleDays);
    const raisedIssues = allIssues.filter(i => i.creator?.id === user.zohoId);

    const todo    = allIssues.filter((i) => i.statusGroup === 'todo').length;
    const doing   = allIssues.filter((i) => i.statusGroup === 'doing').length;
    const done    = allIssues.filter((i) => i.statusGroup === 'done').length;
    const stale   = allIssues.filter((i) => i.isStale).length;
    const overdue = allIssues.filter((i) => i.delayedDays > 0 && i.statusGroup !== 'done').length;
    const collab  = allIssues.filter((i) => i.assignees.length > 1).length;

    res.json({
      user: { id: user.id, zohoId: user.zohoId, name: user.name, email: user.email, role: user.role },
      issues:       allIssues,
      raisedIssues,
      summary:      { total: allIssues.length, todo, doing, done, stale, overdue, collab, raised: raisedIssues.length },
      sprintCount:  activeSprints.length,
      staleDays,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ user profile failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/users/:id/sprint-history — Per-sprint contributor stats for one developer.
 * @route GET /api/users/:id/sprint-history?limit=N (optional, default: 12)
 * @method GET
 * @param {string} id - User's primary DB id (not zohoId)
 * @query limit (optional, default: 12, range: 1-20) - Maximum sprint history entries to return
 * @returns {Object} - Per-sprint issue counts for this developer
 *   {
 *     history: Array<{ sprint: Sprint, createdAt: Date, raised: number, done: number }> - Sorted by sprint date ascending
 *     total: number - Total sprint entries in history
 *   }
 * @notes
 *   - Single DB query against issue creator field (no Zoho calls)
 *   - Counts all issues raised by user in each sprint, grouped by status (done vs open)
 * @auth Required (OAuth token validation)
 */
router.get('/:id/sprint-history', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? '12'), 10) || 12));
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Single DB query — no Zoho calls
    const history = await queryUserSprintHistory(user.zohoId, limit);
    res.json({ history, total: history.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ sprint-history failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/users/sync — Pull user list from Zoho and upsert to local DB.
 * @route POST /api/users/sync
 * @method POST
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from session)
 * @returns {Object} - Sync result with upserted user count
 *   { synced: number, users: User[] } - Array of upserted user objects
 * @notes
 *   - Idempotent: Uses upsert pattern with unique zohoId key
 *   - Only updates name and email from Zoho (role is local-only, not touched)
 *   - Returns immediately with current DB state; actual sync happens in background via setImmediate
 * @error 502 - Triggered if Zoho returns 0 users (authenticated account may lack admin scope)
 * @auth Required (OAuth token validation via fetchZohoUsers())
 */
router.post('/sync', async (_req, res) => {
  try {
    const zohoUsers = await fetchZohoUsers();

    if (zohoUsers.length === 0) {
      res.status(502).json({
        error: 'Zoho returned 0 users. The authenticated account may not have admin access (ZohoSprints.teamusers.READ scope required).',
      });
      return;
    }

    const upserted = await Promise.all(
      zohoUsers.map((u) =>
        prisma.user.upsert({
          where: { zohoId: u.zohoId },
          update: { name: u.name, email: u.email },
          create: { zohoId: u.zohoId, name: u.name, email: u.email, role: 'OTHER' },
        })
      )
    );

    res.json({ synced: upserted.length, users: upserted });
  } catch (err) {
    const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
    const message  = axios.isAxiosError(err)
      ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
      : (err instanceof Error ? err.message : 'Unknown error');
    console.error('❌ Sync failed:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /api/users/:id/role — Update the local role label for a user.
 * @route PATCH /api/users/:id/role
 * @method PATCH
 * @params {string} id - User's primary DB id (not zohoId)
 * @body {Object} body: { role: 'DEV' | 'QA' | 'PROD' | 'OTHER' }
 * @returns {Object} - Updated user object with new role. Response format: { user: User } where User contains { id: string, zohoId: string, name: string, email: string, role: Role }
 *   { user: User }
 * @errors
 *   400 - Invalid role value (must be one of: DEV, QA, PROD, OTHER)
 *   500 - Database error
 * @notes
 *   - Role is a LOCAL field only, not synced from Zoho
 *   - Changes persist across syncs but do not affect Zoho data
 * @auth Required (OAuth token validation)
 */
router.patch('/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role: string };
    
    if (!VALID_ROLES.includes(role as Role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    
    const user = await prisma.user.update({ where: { id }, data: { role } });
    res.json({ user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Role update failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
