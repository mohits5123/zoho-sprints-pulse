/**
 * Projects API - Project management, board settings, and project-specific endpoints.
 *
 * Endpoints for listing projects, syncing the project list from Zoho, managing board types
 * (scrum/kanban), and fetching project-specific data like issues, epics, and user stats.
 *
 * **Board settings** (boardType, hidden, displayOrder) are LOCAL-only fields that don't
 * affect Zoho and persist across syncs. Changes to these are not synced back to Zoho.
 */

import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { syncZohoProjects } from '../../services/zohoProjects';
import { syncSprintHealth } from '../../services/zohoSprints';
import { queryIssues, querySprintEpics, queryKanbanIssues } from '../../services/issueQueries';
import { touchLastSyncedAt } from '../../services/syncStatus';

const router = Router();

/**
 * Extract project number from raw Zoho data.
 * 
 * Parses the rawData field (which is a JSON string) to extract the projNo field.
 * This field may be stored in either 'prop.projNo' or 'fields[index]' depending on
 * how Zoho returns the data. Returns null if parsing fails or field is missing.
 * 
 * @param rawData - JSON string from Zoho project data
 * @returns Project number as string, or null if not found
 */
function extractProjNo(rawData: string | null): string | null {
  try {
    if (!rawData) return null;
    const rd = JSON.parse(rawData) as { fields?: unknown[]; prop?: Record<string, number> };
    const idx = rd.prop?.projNo ?? 1;
    const val = rd.fields?.[idx];
    return val != null ? String(val) : null;
  } catch { return null; }
}

/**
 * GET /api/projects — List all locally stored projects with their active sprints.
 * @route GET /api/projects
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { projects: Project[], total: number }
 *   Each project includes:
 *     - All standard fields (zohoId, name, boardType, hidden, displayOrder, rawData)
 *     - Computed: projNo (extracted from rawData), activeSprints[] (array of active sprint objects)
 * @notes
 *   - Projects are ordered by name ascending (alphabetical)
 *   - Active sprints are those with status='active'
 *   - Sprints are grouped by projectZohoId and attached to their respective projects
 * @auth Required (OAuth token validation)
 */
router.get('/', async (_req, res) => {
  try {
    const projects = await prisma.project.findMany({ orderBy: { name: 'asc' } });
    const sprints  = await prisma.sprint.findMany({ where: { status: 'active' } });

    // Group sprints by projectZohoId
    const sprintsByProject: Record<string, typeof sprints> = {};
    for (const sprint of sprints) {
      if (!sprintsByProject[sprint.projectZohoId]) sprintsByProject[sprint.projectZohoId] = [];
      sprintsByProject[sprint.projectZohoId].push(sprint);
    }

    const projectsWithSprints = projects.map((p) => ({
      ...p,
      projNo: extractProjNo(p.rawData),
      activeSprints: sprintsByProject[p.zohoId] ?? [],
    }));

    res.json({ projects: projectsWithSprints, total: projects.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Projects list failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * POST /api/projects/sync — Sync project list from Zoho, then kick off full sprint sync.
 * @route POST /api/projects/sync
 * @method POST
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from session)
 * @returns {Object} - Immediate response with synced project list
 *   { synced: number, projects: Project[] } - Number of projects synced + refreshed project list
 * @notes
 *   - Idempotent: Uses upsert pattern with unique zohoProjectId key (from Zoho)
 *   - Responds IMMEDIATELY with current DB state after sync
 *   - Full sprint/issue sync runs in BACKGROUND via setImmediate (fire-and-forget)
 *   - Zoho API calls are rate-limited; background sync may take several minutes for large teams
 * @error 502 - If Zoho returns 0 projects (missing scope or permission issue)
 * @auth Required (OAuth token validation via syncZohoProjects())
 */
router.post('/sync', async (_req, res) => {
  try {
    const projectCount = await syncZohoProjects();
    if (projectCount === 0) {
      res.status(502).json({ error: 'Zoho returned 0 projects. Check the backend console for the raw response.' });
      return;
    }

    const projects = await prisma.project.findMany({ orderBy: { displayOrder: 'asc' } });
    const sprints  = await prisma.sprint.findMany({ where: { status: 'active' } });

    const sprintsByProject: Record<string, typeof sprints> = {};
    for (const sprint of sprints) {
      if (!sprintsByProject[sprint.projectZohoId]) sprintsByProject[sprint.projectZohoId] = [];
      sprintsByProject[sprint.projectZohoId].push(sprint);
    }
    const projectsWithSprints = projects.map((p) => ({ ...p, projNo: extractProjNo(p.rawData), activeSprints: sprintsByProject[p.zohoId] ?? [] }));

    // Respond immediately with the freshly synced project list
    res.json({ synced: projectCount, projects: projectsWithSprints });

    // Then run the full sprint/issue sync in the background
    setImmediate(async () => {
      try {
        await syncSprintHealth();
        await touchLastSyncedAt();
        console.log('✅ Background sprint sync complete');
      } catch (err) {
        const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
        const message  = axios.isAxiosError(err)
          ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
          : (err instanceof Error ? err.message : 'Unknown error');
        console.error('❌ Background sprint sync failed:', message);
      }
    });
  } catch (err) {
    const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
    const message  = axios.isAxiosError(err)
      ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
      : (err instanceof Error ? err.message : 'Unknown error');

    console.error('❌ Sync failed:', message);
    res.status(500).json({ error: message });
  }
});

const VALID_BOARD_TYPES = ['scrum', 'kanban', 'other'] as const;
type BoardType = (typeof VALID_BOARD_TYPES)[number];

/**
 * PATCH /api/projects/:id/board-type — Set the board type for a project.
 * @route PATCH /api/projects/:id/board-type
 * @method PATCH
 * @param {string} id - Project's primary DB id (not zohoId)
 * @body {Object} body: { boardType: 'scrum' | 'kanban' | 'other' }
 * @returns {Object} - Updated project object
 *   { project: Project }
 * @notes
 *   - BoardType is a LOCAL field, not synced from Zoho
 *   - Used to determine how issues are grouped in the UI (columns for scrum/kanban, single list for other)
 * @errors 400 - Invalid boardType value
 *   500 - Database error
 * @auth Required (OAuth token validation)
 */
router.patch('/:id/board-type', async (req, res) => {
  try {
    const { id } = req.params;
    const { boardType } = req.body as { boardType: string };

    if (!VALID_BOARD_TYPES.includes(boardType as BoardType)) {
      res.status(400).json({ error: `Invalid boardType. Must be one of: ${VALID_BOARD_TYPES.join(', ')}` });
      return;
    }

    const project = await prisma.project.update({ where: { id }, data: { boardType } });
    res.json({ project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Board type update failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * PATCH /api/projects/:id/display — Toggle hidden or update display order for kanban columns.
 * @route PATCH /api/projects/:id/display
 * @method PATCH
 * @param {string} id - Project's primary DB id (not zohoId)
 * @body {Object} body: { hidden?: boolean, displayOrder?: number } (optional fields)
 * @returns {Object} - Updated project object
 *   { project: Project }
 * @notes
 *   - displayOrder is LOCAL-only, used for customizing kanban column order in UI
 *   - hidden flag determines if project appears in the project list
 *   - These fields are NOT synced to Zoho and persist across syncs
 * @errors 500 - Database error (if both fields provided but invalid)
 * @auth Required (OAuth token validation)
 */
router.patch('/:id/display', async (req, res) => {
  try {
    const { id } = req.params;
    const { hidden, displayOrder } = req.body as { hidden?: boolean; displayOrder?: number };

    const data: { hidden?: boolean; displayOrder?: number } = {};
    if (hidden !== undefined) data.hidden = hidden;
    if (displayOrder !== undefined) data.displayOrder = displayOrder;

    const project = await prisma.project.update({ where: { id }, data });
    res.json({ project });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Display settings update failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * POST /api/projects/reorder — Batch update display order for multiple projects.
 * @route POST /api/projects/reorder
 * @method POST
 * @headers Content-Type: application/json
 * @body {Object} body: { orderedIds: string[] } - Array of project zohoIds in desired order
 * @returns {Object} - Result object
 *   { reordered: number } - Number of projects that were reordered
 * @notes
 *   - Uses database transaction to ensure atomicity (all or nothing)
 *   - displayOrder is set sequentially: index 0, 1, 2, ... for each orderedIds entry
 *   - Only affects visible (non-hidden) projects in order
 * @errors 400 - If orderedIds is not an array
 *   500 - Database transaction failed
 * @auth Required (OAuth token validation)
 */
router.post('/reorder', async (req, res) => {
  try {
    const { orderedIds } = req.body as { orderedIds: string[] };
    
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'orderedIds must be an array' });
      return;
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.project.update({ where: { id }, data: { displayOrder: index } })
      )
    );

    res.json({ reordered: orderedIds.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Project reorder failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/projects/:id/sprints/:sprintId/issues — Fetch issue list for a specific sprint with filters.
 * @route GET /api/projects/:id/sprints/:sprintId/issues?status=...&statusGroup=...&epicId=...&userId=...
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @params {string} sprintId - Sprint's primary DB id (not zohoId)
 * @query status (optional, single value) - Filter by exact status: todo, in_progress, done, closed, resolved
 * @query statusGroup (optional) - Filter by bucket: 'todo', 'doing' (in_progress), or 'done'
 * @query epicId (optional) - Filter by Epic's zohoId if issue is assigned to one
 * @query userId (optional) - Filter by assignee's zohoId
 * @query creatorOnly=true - Only return issues where this user is the creator (not assignee)
 * @query stale=true - Only return issues marked as stale (no update in N days)
 * @query staleDays=N - Override default staleness threshold (default: 7, min: 1)
 * @query watchedStates - Comma-separated list of statuses to watch (e.g., "todo,in_progress")
 * @returns {Object} - Filtered issue list
 *   { issues: Issue[] } - Array of issue objects matching all filter criteria
 * @notes
 *   - Single DB query using queryIssues() from SQLite (no Zoho calls per request)
 *   - creatorOnly filters by Field.CreatedBy.id; userId filters by assignee (Field.Assignees[])
 *   - watchedStates: if provided, only issues with at least one of these statuses are returned
 *   - creatorOnly=false (default) returns issues assigned to user regardless of who created them
 * @auth Required (OAuth token validation)
 */
router.get('/:id/sprints/:sprintId/issues', async (req, res) => {
  try {
    const { id, sprintId } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint)  { res.status(404).json({ error: 'Sprint not found'  }); return; }

    const statusFilter       = req.query.status        ? String(req.query.status)       : undefined;
    const statusGroupFilter  = req.query.statusGroup   ? String(req.query.statusGroup)  : undefined;
    const epicFilter         = req.query.epicId        ? String(req.query.epicId)        : undefined;
    const userFilter         = req.query.userId        ? String(req.query.userId)        : undefined;
    const creatorOnly        = req.query.creatorOnly   === 'true';
    const staleOnly          = req.query.stale         === 'true';
    const staleDays          = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates      = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];

    const issues = await queryIssues(project.zohoId, sprint.zohoId, { statusFilter, statusGroupFilter, epicFilter, userFilter, creatorOnly, staleOnly, staleDays, watchedStates });
    res.json({ issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Issue fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/projects/:id/sprints/:sprintId/epics — Fetch epic breakdown and status groups for a sprint.
 * @route GET /api/projects/:id/sprints/:sprintId/epics?staleDays=N (optional)
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @params {string} sprintId - Sprint's primary DB id (not zohoId)
 * @query staleDays (optional, default: 7) - Days since last update to consider issue stale
 * @query watchedStates (optional) - Comma-separated list of statuses to watch
 * @returns {Object} - Epic-level metrics grouped by status
 *   {
 *     epics: Array<{ zohoId, name, todo, in_progress, done }, ...> - Epic breakdown by status
 *     statusGroups: { [statusId]: 'todo' | 'doing' | 'done' } - Status bucket mapping
 *   }
 * @notes
 *   - StatusGroups are derived from Zoho's status map (status type field 0=todo, 2=doing, 1=done)
 *   - Epics are aggregated from issues in the sprint, grouped by parent Epic ID
 * @auth Required (OAuth token validation)
 */
router.get('/:id/sprints/:sprintId/epics', async (req, res) => {
  try {
    const { id, sprintId } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint)  { res.status(404).json({ error: 'Sprint not found'  }); return; }

    const staleDays     = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];
    
    const { epics, statusGroups } = await querySprintEpics(project.zohoId, sprint.zohoId, staleDays, watchedStates);
    
    res.json({ epics, statusGroups });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Epic fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/projects/:id/sprints/:sprintId/raiser-stats — Per-creator (ticket raiser) stats by status.
 * @route GET /api/projects/:id/sprints/:sprintId/raiser-stats
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @params {string} sprintId - Sprint's primary DB id (not zohoId)
 * @returns {Object} - Per-creator ticket counts across all statuses
 *   { raisers: Array<{ id, name, role, todo, doing, done }> } - Sorted by total tickets raised (descending)
 * @notes
 *   - Aggregates per Field.CreatedBy id, NOT assignees
 *   - Used for "Ticket Raiser" cards that show who created tickets, not who's assigned
 *   - Only counts issues within this specific sprint (not cross-sprint)
 * @auth Required (OAuth token validation)
 */
router.get('/:id/sprints/:sprintId/raiser-stats', async (req, res) => {
  try {
    const { id, sprintId } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint)  { res.status(404).json({ error: 'Sprint not found'  }); return; }

    const issues = await queryIssues(project.zohoId, sprint.zohoId);

    // Aggregate per creator (ticket raiser)
    const map = new Map<string, {
      id: string; name: string; role: string;
      todo: number; doing: number; done: number;
    }>();

    for (const issue of issues) {
      const c = issue.creator;
      if (!c) continue;  // Skip issues without creator data
      
      let entry = map.get(c.id);
      if (!entry) {
        map.set(c.id, { id: c.id, name: c.name, role: c.role, todo: 0, doing: 0, done: 0 });
        entry = map.get(c.id)!;
      }

      if      (issue.statusGroup === 'todo')  entry.todo++;
      else if (issue.statusGroup === 'doing') entry.doing++;
      else if (issue.statusGroup === 'done')  entry.done++;
    }

    // Sort by total tickets raised (todo + doing + done), descending
    const raisers = [...map.values()].sort(
      (a, b) => (b.todo + b.doing + b.done) - (a.todo + a.doing + b.done),
    );

    res.json({ raisers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Raiser stats fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/projects/:id/sprints/:sprintId/user-stats — Per-user (assignee) workload stats for a sprint.
 * @route GET /api/projects/:id/sprints/:sprintId/user-stats?staleDays=N (optional)
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @params {string} sprintId - Sprint's primary DB id (not zohoId)
 * @query staleDays (optional, default: 7) - Days since last update to consider issue stale
 * @query watchedStates (optional) - Comma-separated list of statuses to watch
 * @returns {Object} - Per-user workload breakdown for assigned tickets
 *   {
 *     users: Array<{ id, name, role, todo, doing, done, stale }> - Sorted by active load (descending)
 *     totalStaleIssues: number - Count of UNIQUE stale issues (not double-counted)
 *   }
 * @notes
 *   - Aggregates per assignee (Field.Assignees[]), NOT creator/raiser
 *   - Used for "User Load", "Completion", and "Stale" cards in sprint overview
 *   - Excludes system user (id='-1') which is used for unassigned issues in Zoho
 *   - Active load = todo + doing; sorted highest to lowest
 *   - Stale count is unique (not per-assignee double-counted) to match UI cards
 * @auth Required (OAuth token validation)
 */
router.get('/:id/sprints/:sprintId/user-stats', async (req, res) => {
  try {
    const { id, sprintId } = req.params;
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint)  { res.status(404).json({ error: 'Sprint not found'  }); return; }

    // Fetch ALL issues for this sprint (don't filter by stale here)
    // The isStale flag will be computed correctly based on watchedStates
    const issues = await queryIssues(project.zohoId, sprint.zohoId, { staleDays, watchedStates });

    // Aggregate per assignee only. Creators are surfaced on the
    // Ticket Raiser card (raiser-stats route) and on the sprint/epic
    // card avatars, but NOT on the User Load / Completion / Stale cards
    // — those should reflect assigned work, not raised work.
    
    const assigneeMap = new Map<string, {
      id: string; name: string; role: string;
      todo: number; doing: number; done: number; stale: number;
    }>();

    for (const issue of issues) {
      // Zoho uses '-1' as system assignee for unassigned issues; skip these
      if (!issue.assignees) continue;
      
      for (const user of issue.assignees) {
        if (!user || !user.id || user.id === '-1') continue;
        
        let entry = assigneeMap.get(user.id);
        if (!entry) {
          assigneeMap.set(user.id, { id: user.id, name: user.name, role: user.role, todo: 0, doing: 0, done: 0, stale: 0 });
          entry = assigneeMap.get(user.id)!;
        }

        if      (issue.statusGroup === 'todo')  entry.todo++;
        else if (issue.statusGroup === 'doing') entry.doing++;
        else if (issue.statusGroup === 'done')  entry.done++;
        
        // Count stale for this assignee (may be counted multiple times if assigned to multiple stale issues)
        if (issue.isStale) entry.stale++;
      }
    }

    // Sort by active load (todo + doing) descending, then by total tickets
    const users = [...assigneeMap.values()].sort((a, b) => {
      const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
      return loadDiff !== 0 ? loadDiff : 
             (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
    });

    // Count unique stale issues (not per-assignee double-counted)
    // This matches the staleCount shown on the SprintCard which counts unique stale issues
    const totalStaleIssues = issues.filter((i) => i.isStale).length;

    res.json({ users, totalStaleIssues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ User stats fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/projects/:id — Fetch a single project with its active sprints.
 * @route GET /api/projects/:id
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @returns {Object} - Single project object with active sprints attached
 *   { 
 *     project: Project & { projNo?: string, activeSprints: Sprint[] } 
 *   }
 * @errors 404 - If project not found
 * @notes
 *   - Returns only active sprints (status='active'), NOT all historical sprints
 *   - Active sprints are ordered by createdAt ascending (oldest first)
 * @auth Required (OAuth token validation)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({ where: { id } });
    
    if (!project) { 
      res.status(404).json({ error: 'Project not found' }); 
      return; 
    }

    const activeSprints = await prisma.sprint.findMany({
      where: { projectZohoId: project.zohoId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ project: { ...project, projNo: extractProjNo(project.rawData), activeSprints } });
   } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Project fetch failed:', msg);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

/**
 * GET /api/projects/:id/kanban-user-stats — Per-user workload stats for a kanban board.
 * @route GET /api/projects/:id/kanban-user-stats?staleDays=N (optional)
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @query staleDays (optional, default: 7) - Days since last update to consider issue stale
 * @query watchedStates (optional) - Comma-separated list of statuses to watch
 * @query userId (optional) - Filter by user (creator or assignee)
 * @query creatorOnly (optional, true/false) - Only return issues created by user
 * @returns {Object} - Per-user workload breakdown for kanban board
 *   {
 *     users: Array<{ id, name, role, todo, doing, done, stale }> - Sorted by active load
 *     totalStaleIssues: number - Count of UNIQUE stale issues
 *   }
 * @notes
 *   - Aggregates per assignee (Field.Assignees[]), NOT creator
 *   - Used for kanban board user load cards
 *   - Kanban boards have no sprints - issues flow continuously through status groups
 * @auth Required (OAuth token validation)
 */
/**
 * GET /api/projects/:id/kanban/issues — Fetch issue list for a kanban board with filters.
 * @route GET /api/projects/:id/kanban/issues?status=...&statusGroup=...&epicId=...&userId=...
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @query status (optional) - Filter by exact status string
 * @query statusGroup (optional) - Filter by work bucket (todo/doing/done)
 * @query epicId (optional) - Filter by Epic ID
 * @query userId (optional) - Filter by user (creator or assignee)
 * @query creatorOnly (optional, true/false) - Only return issues created by user
 * @query stale (optional, true/false) - Only return issues marked as stale
 * @query staleDays (optional, default: 7) - Days since last update to consider issue stale
 * @query watchedStates (optional) - Comma-separated list of statuses to watch
 * @returns {Object} - Issue list
 *   { issues: Issue[] } - Array of issue objects matching all filter criteria
 * @notes
 *   - Kanban boards have no sprints - issues flow continuously through status groups
 *   - All filters are applied at query time (status, statusGroup, epic, user, stale)
 * @auth Required (OAuth token validation)
 */
router.get('/:id/kanban/issues', async (req, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const statusFilter       = req.query.status        ? String(req.query.status)       : undefined;
    const statusGroupFilter  = req.query.statusGroup   ? String(req.query.statusGroup)  : undefined;
    const epicFilter         = req.query.epicId        ? String(req.query.epicId)        : undefined;
    const userFilter         = req.query.userId        ? String(req.query.userId)        : undefined;
    const creatorOnly        = req.query.creatorOnly   === 'true';
    const staleOnly          = req.query.stale         === 'true';
    const staleDays          = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates      = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];

    const issues = await queryKanbanIssues(project.zohoId, staleDays, watchedStates, userFilter, creatorOnly);

    // Apply additional filters at query time (status, statusGroup, epic, stale)
    const filtered = issues.filter((issue): boolean => {
      if (statusFilter      && issue.status      !== statusFilter)      return false;
      if (statusGroupFilter && issue.statusGroup  !== statusGroupFilter) return false;
      if (epicFilter && issue.epicId !== epicFilter) return false;
      if (staleOnly && !issue.isStale) return false;
      return true;
    });

    res.json({ issues: filtered });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Kanban issue fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/kanban-user-stats', async (req, res) => {
  try {
    const { id } = req.params;
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];
    const userIdFilter = req.query.userId ? String(req.query.userId) : undefined;
    const creatorOnly = req.query.creatorOnly === 'true';

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    // Fetch ALL issues for this project (don't filter by stale here)
    // The isStale flag will be computed correctly based on watchedStates
    const issues = await queryKanbanIssues(project.zohoId, staleDays, watchedStates, userIdFilter, creatorOnly);

    // Filter issues to only those in watched states for bar graph calculation
    const issuesInWatchedStates = issues.filter(issue => {
      if (watchedStates.length === 0) return true; // No watched states = show all
      return watchedStates.includes(issue.status);
    });

    // Aggregate per assignee only (not creators)
    // Only count issues in watched states (if watchedStates is configured)
    const assigneeMap = new Map<string, {
      id: string; name: string; role: string;
      todo: number; doing: number; done: number; stale: number;
    }>();

    for (const issue of issuesInWatchedStates) {
      if (!issue.assignees) continue;
      
      for (const user of issue.assignees) {
        if (!user || !user.id || user.id === '-1') continue;

        let entry = assigneeMap.get(user.id);
        if (!entry) {
          assigneeMap.set(user.id, { id: user.id, name: user.name, role: user.role, todo: 0, doing: 0, done: 0, stale: 0 });
          entry = assigneeMap.get(user.id)!;
        }

        if (issue.statusGroup === 'todo')  entry.todo++;
        else if (issue.statusGroup === 'doing') entry.doing++;
        else if (issue.statusGroup === 'done') entry.done++;
        
        if (issue.isStale) entry.stale++;
      }
    }

    // Sort by active load (todo + doing) descending, then by total
    const users = [...assigneeMap.values()].sort((a, b) => {
      const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
      return loadDiff !== 0 ? loadDiff : 
             (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
    });

    // Count unique stale issues
    const totalStaleIssues = issues.filter((i) => i.isStale).length;

    res.json({ users, totalStaleIssues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Kanban user stats fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/projects/:id/kanban/stale-count — Get count of stale issues for a kanban board.
 * @route GET /api/projects/:id/kanban/stale-count?staleDays=...&watchedStates=...
 * @method GET
 * @param {string} id - Project's primary DB id (not zohoId)
 * @query staleDays (optional, default: 7) - Days since last update to consider issue stale
 * @query watchedStates (optional) - Comma-separated list of statuses to watch
 * @returns {Object} - Stale count
 *   { staleCount: number } - Count of unique stale issues
 * @notes
 *   - Kanban boards have no sprints - issues flow continuously through status groups
 *   - Only counts issues assigned to someone (not unassigned)
 * @auth Required (OAuth token validation)
 */
router.get('/:id/kanban/stale-count', async (req, res) => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];

    const issues = await queryKanbanIssues(project.zohoId, staleDays, watchedStates, undefined, false);

    // Count unique stale issues (only assigned ones)
    const staleSet = new Set<string>();
    for (const issue of issues) {
      if (issue.isStale && issue.assignees && issue.assignees.length > 0) {
        // Use assignee IDs to get unique issues
        for (const assignee of issue.assignees) {
          if (assignee && assignee.id && assignee.id !== '-1') {
            staleSet.add(issue.zohoId);
          }
        }
      }
    }

    res.json({ staleCount: staleSet.size });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Kanban stale count fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
