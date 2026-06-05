import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { syncZohoProjects } from '../../services/zohoProjects';
import { syncSprintHealth } from '../../services/zohoSprints';
import { queryIssues, querySprintEpics } from '../../services/issueQueries';
import { touchLastSyncedAt } from '../../services/syncStatus';

const router = Router();

function extractProjNo(rawData: string | null): string | null {
  try {
    if (!rawData) return null;
    const rd = JSON.parse(rawData) as { fields?: unknown[]; prop?: Record<string, number> };
    const idx = rd.prop?.projNo ?? 1;
    const val = rd.fields?.[idx];
    return val != null ? String(val) : null;
  } catch { return null; }
}

// GET /api/projects — all locally stored projects with their active sprints
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/sync — sync project list then kick off a full sprint sync in the background
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

// PATCH /api/projects/:id/board-type
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PATCH /api/projects/:id/display — toggle hidden or update displayOrder
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// POST /api/projects/reorder — batch update displayOrder for all visible projects
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
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/projects/:id/sprints/:sprintId/issues — live fetch issue list with filters
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

// GET /api/projects/:id/sprints/:sprintId/epics — live fetch epic breakdown for a sprint
router.get('/:id/sprints/:sprintId/epics', async (req, res) => {
  try {
    const { id, sprintId } = req.params;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint) { res.status(404).json({ error: 'Sprint not found' }); return; }

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

// GET /api/projects/:id/sprints/:sprintId/raiser-stats — per-creator ticket counts by status
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
      if (!c) continue;
      if (!map.has(c.id)) {
        map.set(c.id, { id: c.id, name: c.name, role: c.role, todo: 0, doing: 0, done: 0 });
      }
      const entry = map.get(c.id)!;
      if      (issue.statusGroup === 'todo')  entry.todo++;
      else if (issue.statusGroup === 'doing') entry.doing++;
      else if (issue.statusGroup === 'done')  entry.done++;
    }

    // Sort: total raised desc
    const raisers = [...map.values()].sort(
      (a, b) => (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done),
    );

    res.json({ raisers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Raiser stats fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/projects/:id/sprints/:sprintId/user-stats — per-user todo/doing/done/stale counts
router.get('/:id/sprints/:sprintId/user-stats', async (req, res) => {
  try {
    const { id, sprintId } = req.params;
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const watchedStates = req.query.watchedStates ? String(req.query.watchedStates).split(',').map(s => s.trim()).filter(Boolean) : [];

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sprint = await prisma.sprint.findFirst({ where: { id: sprintId } });
    if (!sprint)  { res.status(404).json({ error: 'Sprint not found'  }); return; }

    const issues = await queryIssues(project.zohoId, sprint.zohoId, { staleDays, watchedStates });

    // Aggregate per assignee only. Creators are surfaced on the
    // Ticket Raiser card (raiser-stats route) and on the sprint/epic
    // card avatars, but NOT on the User Load / Completion / Stale cards
    // — those should reflect assigned work, not raised work.
    const map = new Map<string, {
      id: string; name: string; role: string;
      todo: number; doing: number; done: number; stale: number;
    }>();

    for (const issue of issues) {
      for (const user of issue.assignees) {
        if (!user || !user.id || user.id === '-1') continue;
        if (!map.has(user.id)) {
          map.set(user.id, { id: user.id, name: user.name, role: user.role, todo: 0, doing: 0, done: 0, stale: 0 });
        }
        const entry = map.get(user.id)!;
        if      (issue.statusGroup === 'todo')  entry.todo++;
        else if (issue.statusGroup === 'doing') entry.doing++;
        else if (issue.statusGroup === 'done')  entry.done++;
        if (issue.isStale) entry.stale++;
      }
    }

    // Sort: active load (todo + doing) desc, then total desc
    const users = [...map.values()].sort((a, b) => {
      const loadDiff = (b.todo + b.doing) - (a.todo + a.doing);
      return loadDiff !== 0 ? loadDiff : (b.todo + b.doing + b.done) - (a.todo + a.doing + a.done);
    });

    // Count unique stale issues (not per-assignee double-counted stale)
    // This matches the staleCount shown on the SprintCard which counts unique stale issues
    const totalStaleIssues = issues.filter((i) => i.isStale).length;

    res.json({ users, totalStaleIssues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ User stats fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/projects/:id — single project with its active sprints
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const activeSprints = await prisma.sprint.findMany({
      where: { projectZohoId: project.zohoId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ project: { ...project, projNo: extractProjNo(project.rawData), activeSprints } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
