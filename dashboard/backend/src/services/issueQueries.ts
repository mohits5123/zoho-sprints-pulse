/**
 * Phase 4 — DB Query Layer
 *
 * All functions here read from local SQLite only — zero Zoho API calls.
 * They replace fetchIssues(), fetchSprintEpics() for all runtime routes.
 */

import prisma from '../db/client';
import { Prisma } from '@prisma/client';
import type { IssueItem, EpicBreakdown } from './zohoSprints';

// ── Shared types ──────────────────────────────────────────────────────────────

interface UserInfo {
  id:   string;
  name: string;
  role: string;
}

export interface IssueQueryOpts {
  statusFilter?:      string;
  statusGroupFilter?: string;
  epicFilter?:        string;
  userFilter?:        string;
  creatorOnly?:       boolean;
  staleOnly?:         boolean;
  staleDays?:         number;
  watchedStates?:     string[];
}

// Extended IssueItem with sprint/project context — used in user profile routes
export interface ContextualIssue extends IssueItem {
  sprintId:    string;
  sprintName:  string;
  projectId:   string;
  projectName: string;
}

export interface SprintHistoryItem {
  sprintId:       string;
  sprintName:     string;
  projectName:    string;
  status:         string;
  startDate:      string | null;
  endDate:        string | null;
  assigned:       number;
  done:           number;
  completionPct:  number;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function computeStale(
  createdAt:    string | null,
  statusGroup:  string,
  status:       string,
  staleDays:    number,
  watchedStates: string[],
): boolean {
  if (!createdAt) return false;
  const ts = new Date(createdAt).getTime();
  if (isNaN(ts) || ts <= 0) return false;
  const staleMs  = staleDays * 24 * 60 * 60 * 1000;
  const isWatched = watchedStates.length > 0
    ? watchedStates.includes(status)
    : statusGroup !== 'done';
  return isWatched && (Date.now() - ts) > staleMs;
}

function computeDelayedDays(endDate: string | null, statusGroup: string): number {
  if (!endDate || statusGroup === 'done') return 0;
  const target = new Date(endDate).getTime();
  if (isNaN(target) || target <= 0) return 0;
  const now = Date.now();
  return now > target ? Math.floor((now - target) / (24 * 60 * 60 * 1000)) : 0;
}

/** Build a map of zohoId → UserInfo for efficient lookups */
async function buildUserMap(): Promise<Map<string, UserInfo>> {
  const users = await prisma.user.findMany({ select: { zohoId: true, name: true, role: true } });
  return new Map(users.map(u => [u.zohoId, { id: u.zohoId, name: u.name, role: u.role }]));
}

/** Convert a raw DB Issue row to an IssueItem with computed fields */
function toIssueItem(
  issue: {
    zohoId: string; itemNo: string; title: string;
    status: string; statusGroup: string; epicZohoId: string | null;
    creatorZohoId: string | null; assigneeIds: string;
    createdAt: string | null; endDate: string | null;
  },
  userMap: Map<string, UserInfo>,
  staleDays:     number,
  watchedStates: string[],
): IssueItem {
  let parsedAssigneeIds: string[] = [];
  try { parsedAssigneeIds = JSON.parse(issue.assigneeIds) as string[]; } catch { /* empty */ }

  const assignees: UserInfo[] = parsedAssigneeIds
    .map(id => userMap.get(id) ?? { id, name: 'Unknown', role: 'OTHER' });

  const creator: UserInfo | null = issue.creatorZohoId
    ? (userMap.get(issue.creatorZohoId) ?? { id: issue.creatorZohoId, name: 'Unknown', role: 'OTHER' })
    : null;

  const isStale     = computeStale(issue.createdAt, issue.statusGroup, issue.status, staleDays, watchedStates);
  const delayedDays = computeDelayedDays(issue.endDate, issue.statusGroup);

  return {
    zohoId:      issue.zohoId,
    itemNo:      issue.itemNo,
    title:       issue.title,
    status:      issue.status,
    statusGroup: issue.statusGroup,
    epicId:      issue.epicZohoId ?? null,
    creator,
    assignees,
    createdAt:   issue.createdAt ?? null,
    endDate:     issue.endDate   ?? null,
    delayedDays,
    isStale,
  };
}

/** Apply in-memory opts filters to an already-fetched issue list */
function applyFilters(issues: IssueItem[], opts: IssueQueryOpts): IssueItem[] {
  const {
    statusFilter, statusGroupFilter, epicFilter,
    userFilter, creatorOnly = false, staleOnly = false,
  } = opts;

  return issues.filter((issue): boolean => {
    if (statusFilter      && issue.status      !== statusFilter)      return false;
    if (statusGroupFilter && issue.statusGroup  !== statusGroupFilter) return false;
    if (epicFilter) {
      if (epicFilter === '__unassigned__') { if (issue.epicId)                return false; }
      else                                { if (issue.epicId !== epicFilter) return false; }
    }
    if (userFilter) {
      const isCreator  = issue.creator?.id === userFilter;
      const isAssignee = issue.assignees.some((a) => a.id === userFilter);
      if (creatorOnly ? !isCreator : (!isCreator && !isAssignee)) return false;
    }
    if (staleOnly && !issue.isStale) return false;
    return true;
  });
}

// ── Public query functions ────────────────────────────────────────────────────

/**
 * Query issues for a single sprint from local DB.
 * Replaces fetchIssues() for all per-sprint routes.
 */
export async function queryIssues(
  projectZohoId: string,
  sprintZohoId:  string,
  opts: IssueQueryOpts = {},
): Promise<IssueItem[]> {
  const { staleDays = 7, watchedStates = [] } = opts;

  const dbIssues = await prisma.issue.findMany({
    where: { projectZohoId, sprintZohoId },
  });

  const userMap = await buildUserMap();

  const issues = dbIssues.map(i => toIssueItem(i, userMap, staleDays, watchedStates));
  return applyFilters(issues, opts);
}

/**
 * Query epic breakdown for a sprint from local DB.
 * Replaces fetchSprintEpics() for the /epics route.
 */
export async function querySprintEpics(
  projectZohoId: string,
  sprintZohoId:  string,
  staleDays:     number = 7,
  watchedStates: string[] = [],
): Promise<{ epics: EpicBreakdown[]; statusGroups: Record<string, string> }> {
  const [dbIssues, dbEpics, project, userMap] = await Promise.all([
    prisma.issue.findMany({ where: { projectZohoId, sprintZohoId } }),
    prisma.epic.findMany({ where: { projectZohoId } }),
    prisma.project.findUnique({ where: { zohoId: projectZohoId } }),
    buildUserMap(),
  ]);

  // Parse statusGroups and orderedNames from the stored statusMap
  let statusGroups: Record<string, 'todo' | 'doing' | 'done'> = {};
  let orderedNames: string[] = [];
  if (project?.statusMap) {
    try {
      const parsed = JSON.parse(project.statusMap) as {
        orderedNames?: string[];
        statusGroups?: Record<string, 'todo' | 'doing' | 'done'>;
      };
      statusGroups = parsed.statusGroups ?? {};
      orderedNames = parsed.orderedNames ?? [];
    } catch { /* use empty defaults */ }
  }

  // Build epic name lookup
  const epicNameMap = new Map(dbEpics.map(e => [e.zohoId, e.name]));

  // Group issues by epicId, collecting items per epic
  const epicIssueMap = new Map<string, typeof dbIssues>();
  for (const issue of dbIssues) {
    const key = issue.epicZohoId ?? '__unassigned__';
    if (!epicIssueMap.has(key)) epicIssueMap.set(key, []);
    epicIssueMap.get(key)!.push(issue);
  }

  const results: EpicBreakdown[] = [];

  for (const [epicId, epicIssues] of epicIssueMap) {
    const name = epicId === '__unassigned__'
      ? 'Unassigned'
      : (epicNameMap.get(epicId) ?? `Epic ${epicId}`);

    let staleCount = 0;
    const statusBreakdownRaw: Record<string, number> = {};
    const userSet = new Map<string, UserInfo>();

    for (const issue of epicIssues) {
      const isStale = computeStale(issue.createdAt, issue.statusGroup, issue.status, staleDays, watchedStates);
      if (isStale) staleCount++;

      statusBreakdownRaw[issue.status] = (statusBreakdownRaw[issue.status] ?? 0) + 1;

      // Collect users — both assignees AND the ticket creator
      const userIdsToAdd: string[] = [];
      if (issue.creatorZohoId && issue.creatorZohoId !== '-1') {
        userIdsToAdd.push(issue.creatorZohoId);
      }
      try {
        const parsedAssigneeIds = JSON.parse(issue.assigneeIds) as string[];
        for (const a of parsedAssigneeIds) {
          if (a && a !== '-1') userIdsToAdd.push(a);
        }
      } catch { /* empty */ }

      for (const uid of userIdsToAdd) {
        if (!userSet.has(uid)) {
          userSet.set(uid, userMap.get(uid) ?? { id: uid, name: 'Unknown', role: 'OTHER' });
        }
      }
    }

    // Build ordered status breakdown (respect orderedNames, zero-fill missing)
    const orderedBreakdown: Record<string, number> = {};
    for (const name of orderedNames) {
      orderedBreakdown[name] = statusBreakdownRaw[name] ?? 0;
    }
    for (const [status, count] of Object.entries(statusBreakdownRaw)) {
      if (!(status in orderedBreakdown)) orderedBreakdown[status] = count;
    }

    results.push({
      id:              epicId,
      name,
      total:           epicIssues.length,
      staleCount,
      statusBreakdown: orderedBreakdown,
      statusGroups,
      users:           [...userSet.values()],
    });
  }

  results.sort((a, b) => {
    if (a.id === '__unassigned__') return 1;
    if (b.id === '__unassigned__') return -1;
    return a.name.localeCompare(b.name);
  });

  return { epics: results, statusGroups };
}

/**
 * Aggregate WIP + stale counts across all active sprints per user.
 * Replaces the fetchIssues() × N loop in GET /team/load.
 *
 * Returns users with their todo/doing/done/stale counts, and sprint/project metadata.
 */
export async function queryTeamLoad(staleDays: number = 7): Promise<{
  users:        { id: string; name: string; role: string; todo: number; doing: number; done: number; stale: number }[];
  sprintCount:  number;
  projectCount: number;
}> {
  const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });
  if (activeSprints.length === 0) {
    return { users: [], sprintCount: 0, projectCount: 0 };
  }

  const activeSprintZohoIds = activeSprints.map(s => s.zohoId);

  // Fetch all issues across all active sprints in one DB query
  const dbIssues = await prisma.issue.findMany({
    where: { sprintZohoId: { in: activeSprintZohoIds } },
  });

  const userMap = await buildUserMap();

  const map = new Map<string, { id: string; name: string; role: string; todo: number; doing: number; done: number; stale: number }>();

  // User Load / Completion Rate / Stale Tickets: count only ASSIGNED work,
  // not tickets that the user merely raised. Creators are surfaced on the
  // sprint/epic cards via querySprintEpics, not here.
  for (const issue of dbIssues) {
    const isStale = computeStale(issue.createdAt, issue.statusGroup, issue.status, staleDays, []);

    let parsedAssigneeIds: string[] = [];
    try { parsedAssigneeIds = JSON.parse(issue.assigneeIds) as string[]; } catch { /* empty */ }

    for (const uid of parsedAssigneeIds) {
      if (!uid || uid === '-1') continue;
      if (!map.has(uid)) {
        const u = userMap.get(uid) ?? { id: uid, name: 'Unknown', role: 'OTHER' };
        map.set(uid, { ...u, todo: 0, doing: 0, done: 0, stale: 0 });
      }
      const entry = map.get(uid)!;
      if      (issue.statusGroup === 'todo')  entry.todo++;
      else if (issue.statusGroup === 'doing') entry.doing++;
      else if (issue.statusGroup === 'done')  entry.done++;
      if (isStale) entry.stale++;
    }
  }

  const users = [...map.values()].sort((a, b) =>
    (b.todo + b.doing) - (a.todo + a.doing),
  );

  const projectCount = new Set(activeSprints.map(s => s.projectZohoId)).size;

  return { users, sprintCount: activeSprints.length, projectCount };
}

/**
 * All issues across active sprints for one user (assigned or created by).
 * Replaces the Promise.allSettled(fetchIssues × N sprints) in GET /users/:id/profile.
 *
 * Uses a raw SQL query with json_each for efficient JSON array membership check.
 */
export async function queryUserIssues(
  userZohoId: string,
  staleDays:  number = 7,
): Promise<ContextualIssue[]> {
  const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });
  if (activeSprints.length === 0) return [];

  const activeSprintZohoIds = activeSprints.map(s => s.zohoId);

  // Build sprint lookup for context
  const sprintByZohoId = new Map(activeSprints.map(s => [s.zohoId, s]));

  // Fetch all projects for context
  const projectZohoIds = [...new Set(activeSprints.map(s => s.projectZohoId))];
  const projects = await prisma.project.findMany({
    where: { zohoId: { in: projectZohoIds } },
  });
  const projectByZohoId = new Map(projects.map(p => [p.zohoId, p]));

  // Raw query using json_each to find issues where user is assignee or creator
  // SQLite json_each lets us search inside the JSON array without loading all issues
  type RawIssueRow = {
    id: string; zohoId: string; sprintZohoId: string; projectZohoId: string;
    itemNo: string; title: string; status: string; statusGroup: string;
    epicZohoId: string | null; creatorZohoId: string | null;
    assigneeIds: string; createdAt: string | null; endDate: string | null;
  };

  const sprintPlaceholders = activeSprintZohoIds.map(() => '?').join(', ');
  const rawIssues = await prisma.$queryRawUnsafe<RawIssueRow[]>(
    `SELECT DISTINCT i.*
     FROM "Issue" i
     WHERE i.sprintZohoId IN (${sprintPlaceholders})
       AND (
         i.creatorZohoId = ?
         OR EXISTS (
           SELECT 1 FROM json_each(i.assigneeIds) AS j WHERE j.value = ?
         )
       )`,
    ...activeSprintZohoIds,
    userZohoId,
    userZohoId,
  );

  const userMap = await buildUserMap();

  return rawIssues.map(i => {
    const sprint  = sprintByZohoId.get(i.sprintZohoId);
    const project = projectByZohoId.get(i.projectZohoId);
    const base = toIssueItem(i, userMap, staleDays, []);
    return {
      ...base,
      sprintId:    sprint?.id    ?? '',
      sprintName:  sprint?.name  ?? i.sprintZohoId,
      projectId:   project?.id   ?? '',
      projectName: project?.name ?? i.projectZohoId,
    };
  });
}

/**
 * Sprint-by-sprint history for one user.
 * Replaces Promise.allSettled(fetchIssues × 12 sprints) in GET /users/:id/sprint-history.
 */
export async function queryUserSprintHistory(
  userZohoId:  string,
  sprintLimit: number = 12,
): Promise<SprintHistoryItem[]> {
  const sprints = await prisma.sprint.findMany({
    orderBy: { updatedAt: 'desc' },
    take: sprintLimit,
  });

  if (sprints.length === 0) return [];

  const sprintZohoIds = sprints.map(s => s.zohoId);

  // Build project lookup
  const projectZohoIds = [...new Set(sprints.map(s => s.projectZohoId))];
  const projects = await prisma.project.findMany({
    where: { zohoId: { in: projectZohoIds } },
  });
  const projectByZohoId = new Map(projects.map(p => [p.zohoId, p]));

  // Raw query: get sprint zohoId + statusGroup for all matching issues in one shot
  type SprintCountRow = { sprintZohoId: string; statusGroup: string; cnt: number };
  const sprintPlaceholders = sprintZohoIds.map(() => '?').join(', ');

  const countRows = await prisma.$queryRawUnsafe<SprintCountRow[]>(
    `SELECT i.sprintZohoId, i.statusGroup, COUNT(*) as cnt
     FROM "Issue" i
     WHERE i.sprintZohoId IN (${sprintPlaceholders})
       AND (
         i.creatorZohoId = ?
         OR EXISTS (
           SELECT 1 FROM json_each(i.assigneeIds) AS j WHERE j.value = ?
         )
       )
     GROUP BY i.sprintZohoId, i.statusGroup`,
    ...sprintZohoIds,
    userZohoId,
    userZohoId,
  );

  // Aggregate counts per sprint
  const sprintStats = new Map<string, { assigned: number; done: number }>();
  for (const row of countRows) {
    if (!sprintStats.has(row.sprintZohoId)) {
      sprintStats.set(row.sprintZohoId, { assigned: 0, done: 0 });
    }
    const s = sprintStats.get(row.sprintZohoId)!;
    const count = typeof row.cnt === 'bigint' ? Number(row.cnt) : Number(row.cnt);
    s.assigned += count;
    if (row.statusGroup === 'done') s.done += count;
  }

  // Build history items — only include sprints where user had at least 1 issue
  const history: SprintHistoryItem[] = [];
  for (const sprint of sprints) {
    const stats = sprintStats.get(sprint.zohoId);
    if (!stats || stats.assigned === 0) continue;
    const project = projectByZohoId.get(sprint.projectZohoId);
    history.push({
      sprintId:      sprint.id,
      sprintName:    sprint.name,
      projectName:   project?.name ?? sprint.projectZohoId,
      status:        sprint.status,
      startDate:     sprint.startDate ?? null,
      endDate:       sprint.endDate   ?? null,
      assigned:      stats.assigned,
      done:          stats.done,
      completionPct: Math.round((stats.done / stats.assigned) * 100),
    });
  }

  return history.reverse(); // chronological order
}
