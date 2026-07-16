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
import { queryUserIssues, queryUserSprintHistory, type ContextualIssue } from '../../services/issueQueries';

const USER_DELETION_THRESHOLD = 2;

// All route handlers below are mounted under the Express router and protected by the
// application-level OAuth middleware (applied when this router is registered in the app).

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
    const users = await prisma.user.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
    res.json({ users, total: users.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Users list failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

router.get('/deleted', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        zohoId: true,
        name: true,
        email: true,
        role: true,
        deletedAt: true,
        missingSyncCount: true,
      },
    });
    res.json({ users });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deleted users fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/users/:id/profile — Cross-sprint issue summary for one developer.
 * @route GET /api/users/:id/profile?staleDays=N (optional)
 * @method GET
 * @param {string} id - User's zohoId (primary key)
 * @query staleDays (optional, default: 7, min: 1) - Days since last update to consider issue stale
 * @returns {Object} - User profile with issue metrics across all active sprints
 *   {
 *     user: { zohoId, name, email, role },
 *     issues: Array<Issue> - All issues created by this user (across all active sprints)
 *     raisedIssues: Issue[] - Issues created by this user in the last 30 days (across all sprints)
 *     summary: { total, todo, doing, done, stale, overdue, collab, raised } - Aggregate counts
 *     sprintCount: number - Total active sprints in system
 *     staleDays: number - Used staleness threshold for this query
 *   }
 * @notes
 *   - Single DB query, no Zoho calls per request (uses cached SQLite data)
 *   - issues are filtered to only active sprints via queryUserIssues()
 *   - raisedIssues are filtered by createdAt >= 30 days ago across all sprints
 *   - Creators != assignees; creator is who raised the ticket, not necessarily who's working on it
 * @auth Required (OAuth token validation)
 */
router.get('/:id/profile', async (req, res) => {
  try {
    // Parse staleness threshold — defaults to 7 days, clamped to minimum of 1.
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    // Optional comma-separated list of Zoho issue states to include; defaults to all states.
    const watchedStates = req.query.watchedStates
      ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const user = await prisma.user.findUnique({ where: { zohoId: req.params.id, deletedAt: null } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });

    // Single DB query — no Zoho calls
    const allIssues = await queryUserIssues(user.zohoId, staleDays, watchedStates);

    // Raised issues: tickets created by this user in the last 30 days, across all sprints.
    // This is a separate query from allIssues (which is scoped to active sprints).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    type RawRaisedRow = {
      zohoId: string; sprintZohoId: string; projectZohoId: string;
      itemNo: string; title: string; status: string; statusGroup: string;
      epicZohoId: string | null; creatorZohoId: string | null;
      assigneeIds: string; createdAt: string | null; endDate: string | null;
    };
    const rawRaised = await prisma.$queryRawUnsafe<RawRaisedRow[]>(
      `SELECT i.* FROM "Issue" i
       WHERE i.creatorZohoId = ?
         AND i.createdAt >= ?`,
      user.zohoId,
      thirtyDaysAgo,
    );

    // Build sprint/project lookup maps for context enrichment
    const allSprintZohoIds  = [...new Set(rawRaised.map(r => r.sprintZohoId))];
    const allProjectZohoIds = [...new Set(rawRaised.map(r => r.projectZohoId))];
    const [sprintRows, projectRows] = await Promise.all([
      allSprintZohoIds.length  > 0 ? prisma.sprint.findMany({ where: { zohoId: { in: allSprintZohoIds  } } }) : [],
      allProjectZohoIds.length > 0 ? prisma.project.findMany({ where: { zohoId: { in: allProjectZohoIds } } }) : [],
    ]);
    const sprintByZohoId  = new Map(sprintRows.map(s  => [s.zohoId,  s]));
    const projectByZohoId = new Map(projectRows.map(p => [p.zohoId, p]));

    // Build userMap for name resolution (reused from allIssues path via prisma)
    const userRows = await prisma.user.findMany();
    const userMap  = new Map(userRows.map(u => [u.zohoId, { id: u.zohoId, name: u.name, role: u.role }]));

    const raisedIssues: ContextualIssue[] = rawRaised.map(row => {
      let parsedAssigneeIds: string[] = [];
      try { parsedAssigneeIds = JSON.parse(row.assigneeIds) as string[]; } catch { /* empty */ }

      const creator = row.creatorZohoId
        ? (userMap.get(row.creatorZohoId) ?? { id: row.creatorZohoId, name: 'Unknown', role: 'OTHER' })
        : null;
      const assignees = parsedAssigneeIds.map(id => userMap.get(id) ?? { id, name: 'Unknown', role: 'OTHER' });

      const sprint  = sprintByZohoId.get(row.sprintZohoId);
      const project = projectByZohoId.get(row.projectZohoId);

      const nowMs = Date.now();
      const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : nowMs;
      const daysSinceUpdate = Math.floor((nowMs - createdMs) / 86_400_000);
      const isStale = row.statusGroup !== 'done' && daysSinceUpdate >= staleDays;
      const delayedDays = (row.endDate && row.statusGroup !== 'done')
        ? Math.max(0, Math.floor((nowMs - new Date(row.endDate).getTime()) / 86_400_000))
        : 0;

      return {
        zohoId:      row.zohoId,
        itemNo:      row.itemNo,
        title:       row.title,
        status:      row.status,
        statusGroup: row.statusGroup,
        epicId:      row.epicZohoId ?? null,
        creator,
        assignees,
        createdAt:   row.createdAt   ?? null,
        endDate:     row.endDate     ?? null,
        delayedDays,
        isStale,
        sprintId:    sprint?.zohoId    ?? row.sprintZohoId,
        sprintName:  sprint?.name      ?? row.sprintZohoId,
        projectId:   project?.zohoId   ?? row.projectZohoId,
        projectName: project?.name     ?? row.projectZohoId,
      };
    });

    const todo    = allIssues.filter((i) => i.statusGroup === 'todo').length;
    const doing   = allIssues.filter((i) => i.statusGroup === 'doing').length;
    const done    = allIssues.filter((i) => i.statusGroup === 'done').length;
    const stale   = allIssues.filter((i) => i.isStale).length;
    const overdue = allIssues.filter((i) => i.delayedDays > 0 && i.statusGroup !== 'done').length;
    const collab  = allIssues.filter((i) => i.assignees.length > 1).length;

    res.json({
      user: { zohoId: user.zohoId, name: user.name, email: user.email, role: user.role },
      issues:       allIssues,
      raisedIssues,
      summary:      { total: allIssues.length, todo, doing, done, stale, overdue, collab, raised: raisedIssues.length },
      sprintCount:  activeSprints.length,
      staleDays,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('user profile failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/users/:id/sprint-history — Per-sprint contributor stats for one developer.
 * @route GET /api/users/:id/sprint-history?limit=N (optional, default: 12)
 * @method GET
 * @param {string} id - User's zohoId (primary key)
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
    const user = await prisma.user.findUnique({ where: { zohoId: req.params.id, deletedAt: null } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Single DB query — no Zoho calls
    const history = await queryUserSprintHistory(user.zohoId);
    res.json({ history, total: history.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('sprint-history failed:', msg);
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
    const syncStartTime = new Date();
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
          update: { name: u.name, email: u.email, syncedAt: new Date(), missingSyncCount: 0, deletedAt: null },
          create: { zohoId: u.zohoId, name: u.name, email: u.email, role: 'OTHER', syncedAt: new Date(), missingSyncCount: 0, deletedAt: null },
        })
      )
    );

    await detectAndRemoveDeletedUsers(syncStartTime);

    res.json({ synced: upserted.length, users: upserted });
  } catch (err) {
    const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
    const message  = axios.isAxiosError(err)
      ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
      : (err instanceof Error ? err.message : 'Unknown error');
    console.error('Sync failed:', message);
    res.status(500).json({ error: message });
  }
});

async function detectAndRemoveDeletedUsers(syncStartTime: Date): Promise<void> {
  const missedUsers = await prisma.user.findMany({
    where: {
      syncedAt: { lt: syncStartTime },
      deletedAt: null,
    },
    select: { zohoId: true, name: true, email: true, missingSyncCount: true },
  });

  if (missedUsers.length === 0) return;

  const userIdsToIncrement = missedUsers.map(u => u.zohoId);
  await prisma.user.updateMany({
    where: { zohoId: { in: userIdsToIncrement } },
    data: { missingSyncCount: { increment: 1 } },
  });

  const usersToDelete = await prisma.user.findMany({
    where: {
      zohoId: { in: userIdsToIncrement },
      missingSyncCount: { gte: USER_DELETION_THRESHOLD },
      deletedAt: null,
    },
    select: { zohoId: true, name: true, email: true },
  });

  if (usersToDelete.length === 0) {
    console.log(`[User Deletion Detection] ${missedUsers.length} users missed, none reached threshold`);
    return;
  }

  const deletedAt = new Date();
  const deletedIds = usersToDelete.map(u => u.zohoId);

  await prisma.user.updateMany({
    where: { zohoId: { in: deletedIds } },
    data: { deletedAt },
  });

  console.log(`[User Deletion Detection] Soft-deleted ${usersToDelete.length} users after ${USER_DELETION_THRESHOLD} consecutive misses:`);
  usersToDelete.forEach(u => console.log(`  - ${u.name} (${u.zohoId})`));

  const notifications = usersToDelete.map(user => ({
    id: `deleted_user_${user.zohoId}_${deletedAt.getTime()}`,
    userId: 'system',
    type: 'user_deleted',
    issueId: null,
    boardId: null,
    noteId: null,
    oldStatus: '',
    newStatus: '',
    message: `User "${user.name}" (${user.email ?? 'no email'}) was soft-deleted after going missing from Zoho for ${USER_DELETION_THRESHOLD} consecutive syncs (zohoId: ${user.zohoId}).`,
    read: false,
    createdAt: deletedAt,
  }));

  if (notifications.length > 0) {
    await prisma.activityNotification.createMany({ data: notifications });
  }
}

/**
 * PATCH /api/users/:id/role — Update the local role label for a user.
 * @route PATCH /api/users/:id/role
 * @method PATCH
 * @params {string} id - User's zohoId (primary key)
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

    // Validate that the role is one of the allowed local-only labels.
    if (!VALID_ROLES.includes(role as Role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    
    const user = await prisma.user.update({ where: { zohoId: id }, data: { role } });
    res.json({ user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Role update failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
