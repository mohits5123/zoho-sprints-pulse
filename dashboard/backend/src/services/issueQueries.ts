/**
 * Phase 4 — DB Query Layer
 *
 * All functions here read from local SQLite only — zero Zoho API calls.
 * They replace fetchIssues(), fetchSprintEpics() for all runtime routes.
 *
 * This module implements a local-first query layer that translates UI requests
 * into efficient SQLite queries. It computes derived fields (isStale, delayedDays)
 * at query time using issue metadata rather than storing them in the database.
 *
 * Key Features:
 * - Single DB fetch per query (vs N+1 queries in original implementation)
 * - SQLite json_each() for efficient JSON array membership checks (assigneeIds)
 * - Lazy computation of stale/delayed flags based on timestamps
 * - Type-safe interfaces for consistent data structures across routes
 *
 * Architecture:
 * 1. Build userMap once per query session for efficient lookups
 * 2. Fetch raw data from DB in single query
 * 3. Transform to IssueItem with computed fields (isStale, delayedDays)
 * 4. Apply in-memory filters if needed
 *
 * @example Usage for per-sprint issue queries:
 * ```typescript
 * const issues = await queryIssues('PROJ-123', 'SPRINT-456', {
 *   statusGroupFilter: 'doing',
 *   staleOnly: true,
 * });
 * ```
 *
 * @example Usage for team load metrics:
 * ```typescript
 * const teamLoad = await queryTeamLoad(7); // default staleDays = 7
 * console.log('Total WIP:', teamLoad.users.reduce((sum, u) => sum + u.todo + u.doing, 0));
 * ```
 */

import prisma from '../db/client';

import type { IssueItem, EpicBreakdown } from './zohoSprints';

// ── Shared types ──────────────────────────────────────────────────────────────

/**
 * User information structure with Zoho ID mapping.
 * Used as a lookup key between the local database and user metadata.
 * The 'id' field matches the zohoId to enable efficient Map lookups.
 */
interface UserInfo {
  id:   string; // Zoho user ID, matches the key in the Map
  name: string; // Display name from Zoho profile
  role: string; // Local override (DEV/PROD/OTHER) set via UI
}

/**
 * Query options for filtering and computing stale status.
 * Passed to issue query functions to apply runtime filters.
 *
 * @param statusFilter - Filter issues by exact Zoho status string (e.g., "In Progress")
 * @param statusGroupFilter - Filter by work bucket: 'todo', 'doing', or 'done'
 * @param epicFilter - Filter by Epic ID. Use '__unassigned__' for unassigned issues
 * @param userFilter - Filter by Zoho user ID (creator or assignee)
 * @param creatorOnly - If true, only include issues created by the specified user (not assigned)
 * @param staleOnly - If true, only include issues marked as stale by computeStale()
 * @param staleDays - Threshold in days for staleness (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness. If empty, watches all non-'done' states
 *
 * @example Basic query with stale filter:
 * ```typescript
 * await queryIssues('PROJ-1', 'SPRINT-1', { staleOnly: true, staleDays: 5 });
 * ```
 */
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

/**
 * Extended IssueItem with sprint/project context — used in user profile routes.
 * Adds human-readable names for sprints and projects alongside Zoho IDs.
 * This extends IssueItem with metadata needed for displaying contextual information.
 */
export interface ContextualIssue extends IssueItem {
  sprintId:    string; // Sprint's local ID (from Prisma model)
  sprintName:  string; // Sprint's display name
  projectId:   string; // Project's local ID (from Prisma model)
  projectName: string; // Project's display name
}

/**
 * Sprint history item for user profile page.
 * Represents aggregate statistics of a user's work across a completed sprint.
 * Used to show workload history and completion rates over time.
 */
export interface SprintHistoryItem {
  /** Local ID of the sprint (from Prisma model) */
  sprintId:       string;
  /** Display name of the sprint */
  sprintName:     string;
  /** Name of the project this sprint belongs to */
  projectName:    string;
  /** Sprint status at completion (e.g., "completed", "cancelled") */
  status:         string;
  /** Sprint start date as ISO string or null if unknown */
  startDate:      string | null;
  /** Sprint end date as ISO string or null if unknown */
  endDate:        string | null;
  /** Total issues assigned to this user in the sprint */
  assigned:       number;
  /** Issues marked as 'done' by this user in the sprint */
  done:           number;
  /** Percentage completion (0-100) rounded to nearest integer */
  completionPct:  number;
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/**
 * Determine if an issue is stale based on creation date and watched states.
 *
 * An issue is considered stale if:
 * 1. It has a valid creation timestamp
 * 2. The watchedStates is either empty (watches all non-done states) OR contains the issue's current status
 * 3. The time since creation exceeds staleMs (staleDays in milliseconds)
 *
 * Staleness logic: Issues in 'done' status group are never watched for staleness.
 * For other statuses, if watchedStates is specified, only those exact statuses are watched.
 * Otherwise, all non-'done' statuses are watched.
 *
 * @param createdAt - ISO timestamp string when the issue was created (e.g., "2024-01-01T10:00:00Z")
 * @param statusGroup - The work bucket: 'todo', 'doing', or 'done'
 * @param status - The exact Zoho status string (e.g., "In Progress", "Closed")
 * @param staleDays - Number of days after which an issue is considered stale (default: 7)
 * @param watchedStates - Array of specific statuses to watch. If empty, all non-'done' states are watched
 * @returns true if the issue is stale and should be filtered, false otherwise
 *
 * @example Check if a bug older than 10 days is stale:
 * ```typescript
 * const isStale = computeStale('2024-01-01T10:00:00Z', 'todo', 'In Progress', 10, []);
 * // Returns true if current time > 10 days since createdAt and statusGroup !== 'done'
 * ```
 *
 * @example Check specific statuses only:
 * ```typescript
 * const isStale = computeStale('2024-01-01T10:00:00Z', 'doing', 'In Progress', 7, ['Closed']);
 * // Returns false because status "In Progress" is not in watchedStates ["Closed"]
 * ```
 */
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

/**
 * Calculate how many days past the target date an issue is delayed.
 * Only applies to issues not in 'done' status group.
 *
 * The endDate comes from the sprint's endDate, not the issue itself.
 * If the current date is past the target date and the issue is still open (not done),
 * it calculates the number of days between target date and now.
 *
 * @param endDate - ISO timestamp string when the issue was due (from sprint.endDate)
 * @param statusGroup - The work bucket: 'todo', 'doing', or 'done'
 * @returns Number of days delayed, or 0 if not delayed or in done group
 *
 * @example Calculate delay for an overdue story:
 * ```typescript
 * const daysDelayed = computeDelayedDays('2024-01-01T00:00:00Z', 'todo');
 * // Returns 5 if today is 2024-01-07 and the issue is still in 'todo'
 * ```
 *
 * @example No delay if sprint extended:
 * ```typescript
 * const daysDelayed = computeDelayedDays('2024-06-01T00:00:00Z', 'doing');
 * // Returns 0 if current date is before June 1st (due date not passed)
 * ```
 */
function computeDelayedDays(endDate: string | null, statusGroup: string): number {
  if (!endDate || statusGroup === 'done') return 0;
  const target = new Date(endDate).getTime();
  if (isNaN(target) || target <= 0) return 0;
  const now = Date.now();
  return now > target ? Math.floor((now - target) / (24 * 60 * 60 * 1000)) : 0;
}

/**
 * Build a lookup map of Zoho user IDs to UserInfo objects.
 * Used for efficient user name/role lookups in query results.
 *
 * This function is called once per major query operation and the resulting Map
 * is passed to transformation functions. Each issue enrichment lookup is O(1)
 * instead of requiring a database query per user.
 *
 * The returned Map uses zohoId as the key, ensuring consistent lookups across
 * multiple query functions without rebuilding on each call.
 *
 * @async This is an async function that performs a database query
 * @returns A Map where key is zohoId and value is UserInfo {id, name, role}
 *
 * @example Build user map before processing issues:
 * ```typescript
 * const userMap = await buildUserMap();
 * // userMap.get('USER-123') returns { id: 'USER-123', name: 'Alice', role: 'DEV' }
 * // userMap.get('USER-456') returns { id: 'USER-456', name: 'Bob', role: 'QA' }
 * ```
 */
async function buildUserMap(): Promise<Map<string, UserInfo>> {
  const users = await prisma.user.findMany({ select: { zohoId: true, name: true, role: true } });
  return new Map(users.map(u => [u.zohoId, { id: u.zohoId, name: u.name, role: u.role }]));
}

/**
 * Convert a raw database Issue row to an enriched IssueItem with computed fields.
 * This is the core transformation function that enriches raw Zoho data with:
 * - User names for creator and assignees (via userMap lookup)
 * - Computed isStale flag based on creation date and staleDays threshold
 * - Computed delayedDays based on endDate and current time
 *
 * The assigneeIds field is stored as a JSON string array in the database, so it
 * must be parsed here. The function gracefully handles malformed JSON by treating
 * the field as empty rather than throwing an error.
 *
 * @param issue - Raw database row containing Zoho's Issue schema with fields: zohoId, itemNo, title, status, statusGroup, epicZohoId, creatorZohoId, assigneeIds (JSON string), createdAt, endDate
 * @param userMap - Map of zohoId → UserInfo for name lookups (built by buildUserMap)
 * @param staleDays - Threshold in days for staleness calculation (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness (default: empty = watch all non-done)
 * @returns An IssueItem with all derived fields computed and enriched user information
 *
 * @example Transform a raw DB row:
 * ```typescript
 * const rawIssue = { zohoId: 'BUG-123', itemNo: 'ITEM-456', title: 'Fix login bug', status: 'Closed', ... };
 * const enriched = toIssueItem(rawIssue, userMap, 7, []);
 * // Returns { zohoId: 'BUG-123', ..., isStale: false, delayedDays: 0, ... }
 * ```
 *
 * @example Transform with custom stale threshold:
 * ```typescript
 * const enriched = toIssueItem(rawIssue, userMap, 10, ['In Progress']);
 * // Only issues with status 'In Progress' are watched for staleness with 10-day threshold
 * ```
 */
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

/**
 * Apply runtime filters to an already-fetched issue list.
 * Performs in-memory filtering based on opts parameters after data is fetched from DB.
 *
 * IMPORTANT: For efficient queries, use the raw SQL filters in queryUserIssues instead.
 * This function is memory-inefficient for large datasets but simplifies filter logic.
 * The filters applied:
 * - statusFilter: exact match on status string
 * - statusGroupFilter: exact match on work bucket (todo/doing/done)
 * - epicFilter: filter by epic ID or '__unassigned__' for unassigned issues
 * - userFilter + creatorOnly: if true, only match creators; if false/default, match neither
 * - staleOnly: only include issues where isStale flag is true
 *
 * @param issues - Array of IssueItem objects (already fetched and enriched)
 * @param opts - Filtering options from IssueQueryOpts
 * @returns Filtered array of issues matching all active filters
 *
 * @example Apply multiple filters:
 * ```typescript
 * const filtered = applyFilters(allIssues, {
 *   statusGroupFilter: 'todo',
 *   epicFilter: 'EPIC-789',
 *   staleOnly: true,
 * });
 * ```
 *
 * @example Filter for a specific user's issues:
 * ```typescript
 * const myIssues = applyFilters(allIssues, {
 *   userFilter: 'USER-123',  // matches creator OR assignees
 * });
 * ```
 */
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
 * Query issues for a single sprint from local SQLite database.
 * Replaces fetchIssues() for all per-sprint routes (e.g., IssueListPage, BoardPage).
 *
 * This is the primary entry point for fetching issues within a specific sprint.
 * It performs:
 * 1. Single DB query to fetch all issues for the given projectZohoId/sprintZohoId
 * 2. Builds userMap once for O(1) lookups
 * 3. Transforms each row to IssueItem with computed fields
 * 4. Applies any runtime filters from opts
 *
 * Performance characteristics: O(n) where n is the number of issues in the sprint.
 * The DB query uses index on (projectZohoId, sprintZohoId) for efficiency.
 * User lookups are O(1) via Map, avoiding N+1 query problem.
 *
 * @param projectZohoId - The Zoho ID of the project (e.g., "PROJ-123")
 * @param sprintZohoId - The Zoho ID of the sprint (e.g., "SPRINT-456")
 * @param opts - Optional query options for filtering and stale computation
 * @async Performs database query, returns when complete
 * @returns Array of IssueItem objects with enriched user data and computed fields
 *
 * @example Basic per-sprint issue query (used by board view):
 * ```typescript
 * const issues = await queryIssues('PROJ-123', 'SPRINT-456');
 * // Returns all issues for this sprint with user names and computed stale flags
 * ```
 *
 * @example Query with status and stale filters:
 * ```typescript
 * const issues = await queryIssues('PROJ-123', 'SPRINT-456', {
 *   statusGroupFilter: 'doing',
 *   staleOnly: true,
 *   staleDays: 5, // override default of 7 days
 * });
 * // Returns only 'doing' issues that are stale (>5 days old)
 * ```
 *
 * @example Query with user filter (creator or assignee):
 * ```typescript
 * const issues = await queryIssues('PROJ-123', 'SPRINT-456', {
 *   userFilter: 'USER-789',  // matches creator OR any assignee
 * });
 * ```
 *
 * @example Query only stale issues:
 * ```typescript
 * const staleIssues = await queryIssues('PROJ-123', 'SPRINT-456', {
 *   staleOnly: true,
 * });
 * ```
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
  
  // Transform raw DB rows to enriched IssueItems with computed fields
  let issues = dbIssues.map(i => toIssueItem(i, userMap, staleDays, watchedStates));
  
  // Filter by watched states if configured (for staleness calculation and bar graph)
  // If watchedStates is empty, show all issues (default behavior)
  if (watchedStates.length > 0) {
    const filtered = issues.filter(issue => watchedStates.includes(issue.status));
    issues = filtered;
  }
  
  // Apply any runtime filters (status, epic, user, stale)
  return applyFilters(issues, opts);
}

/**
 * Query issues for a kanban board by project.
 * Kanban boards don't have sprints in the traditional sense - they're continuous flow.
 * The board items are stored as issues with sprintZohoId pointing to the kanban board.
 *
 * @param projectZohoId - The Zoho ID of the kanban project
 * @param staleDays - Threshold in days for staleness (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness
 * @param userFilter - Optional: filter by specific user (creator or assignee)
 * @param creatorOnly - If true, only return issues created by the user
 *
 * @returns Array of IssueItems for all issues in the kanban board (excluding backlog)
 */
export async function queryKanbanBoardIssues(
  projectZohoId: string,
  staleDays: number = 7,
  watchedStates: string[] = [],
  userFilter?: string,
  creatorOnly?: boolean,
): Promise<IssueItem[]> {
  // Identify kanban board sprint IDs (type=[7] sprints)
  const kanbanSprints = await prisma.sprint.findMany({
    where: { projectZohoId },
    select: { zohoId: true, rawData: true },
  });
  
  const kanbanSprintIds = new Set<string>();
  for (const sprint of kanbanSprints) {
    if (sprint.rawData) {
      try {
        const parsed = JSON.parse(sprint.rawData);
        if (parsed?.sprint?.statusCode === 7) {
          kanbanSprintIds.add(sprint.zohoId);
        }
      } catch { /* skip invalid JSON */ }
    }
  }
  
  // Filter to only kanban board issues (exclude backlog)
  const dbIssues = await prisma.issue.findMany({
    where: { projectZohoId },
  });
  
  const userMap = await buildUserMap();
  const kanbanIssues = dbIssues.filter(i => kanbanSprintIds.has(i.sprintZohoId));
  
  // Transform raw DB rows to enriched IssueItems with computed fields
  let filteredIssues: IssueItem[] = kanbanIssues.map(i => toIssueItem(i, userMap, staleDays, watchedStates));
  
  // Filter by watched states if configured
  if (watchedStates.length > 0) {
    filteredIssues = filteredIssues.filter(issue => watchedStates.includes(issue.status));
  }
  
  // Apply optional user/creator filters
  if (userFilter || creatorOnly) {
    filteredIssues = filteredIssues.filter(issue => {
      const matchesUserFilter = userFilter ? (issue.creator?.id === userFilter || issue.assignees.some(a => a.id === userFilter)) : true;
      const matchesCreatorOnly = creatorOnly ? (issue.creator?.id === userFilter) : true;
      return matchesUserFilter && matchesCreatorOnly;
    });
  }
  
  return filteredIssues;
}

/**
 * Query backlog issues for a project.
 * Backlog issues are stored with sprintZohoId = backlogId from Zoho.
 * This is used to display backlog items on the backlog board.
 *
 * @param projectZohoId - The Zoho ID of the project
 * @param staleDays - Threshold in days for staleness (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness
 * @param userFilter - Optional: filter by specific user (creator or assignee)
 * @param creatorOnly - If true, only return issues created by the user
 *
 * @returns Array of IssueItems for all backlog issues
 */
export async function queryBacklogIssues(
  projectZohoId: string,
  staleDays: number = 7,
  watchedStates: string[] = [],
  userFilter?: string,
  creatorOnly?: boolean,
): Promise<IssueItem[]> {
  const project = await prisma.project.findUnique({
    where: { zohoId: projectZohoId },
    select: { backlogZohoId: true },
  });
  
  if (!project?.backlogZohoId) {
    return [];
  }
  
  const dbIssues = await prisma.issue.findMany({
    where: {
      projectZohoId,
      sprintZohoId: project.backlogZohoId,
    },
  });
  
  const userMap = await buildUserMap();
  
  let backlogIssues: IssueItem[] = dbIssues.map(i => toIssueItem(i, userMap, staleDays, watchedStates));
  
  if (watchedStates.length > 0) {
    backlogIssues = backlogIssues.filter(issue => watchedStates.includes(issue.status));
  }
  
  if (userFilter || creatorOnly) {
    backlogIssues = backlogIssues.filter(issue => {
      const matchesUserFilter = userFilter ? (issue.creator?.id === userFilter || issue.assignees.some(a => a.id === userFilter)) : true;
      const matchesCreatorOnly = creatorOnly ? (issue.creator?.id === userFilter) : true;
      return matchesUserFilter && matchesCreatorOnly;
    });
  }
  
  return backlogIssues;
}

/**
 * Query epic breakdown for a sprint from local SQLite database.
 * Used by the /epics route to show Epic cards with issue distribution.
 *
 * This function groups issues by their epic assignment and computes comprehensive
 * metrics for each epic including:
 * - Total count of issues per epic (including unassigned)
 * - Stale issue count per epic (based on staleDays threshold)
 * - Status breakdown for each epic (ordered by statusMap configuration)
 * - List of unique users involved in that epic (assignees + creators if different from assignee)
 * - Status groups mapping for bucket visualization
 *
 * The function handles unassigned issues by grouping them under '__unassigned__' key.
 * Epic names come from the database, falling back to "Epic {id}" if name is missing.
 *
 * Performance: Single DB query to fetch issues + epics, then processes in memory.
 * User collection is done once per epic to avoid duplicates in the results.
 *
 * @param projectZohoId - The Zoho ID of the project (e.g., "PROJ-123")
 * @param sprintZohoId - The Zoho ID of the sprint (e.g., "SPRINT-456")
 * @param staleDays - Threshold in days for staleness calculation (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness. If empty, all non-'done' states are watched
 * @async Performs database queries, returns when complete
 * @returns Object containing { epics: EpicBreakdown[], statusGroups: Record<string, 'todo' | 'doing' | 'done'> }
 *
 * @example Basic epic breakdown query:
 * ```typescript
 * const { epics, statusGroups } = await querySprintEpics('PROJ-123', 'SPRINT-456');
 * console.log('Epic "Auth Flow":', epics.find(e => e.name === 'Auth Flow').total);
 * ```
 *
 * @example Query with custom stale threshold:
 * ```typescript
 * const { epics } = await querySprintEpics('PROJ-123', 'SPRINT-456', 10, ['In Progress']);
 * // Only 'In Progress' issues are watched for staleness with 10-day threshold
 * ```
 *
 * @example Access epic breakdown by status:
 * ```typescript
 * const authEpic = epics.find(e => e.name === 'Auth Flow');
 * console.log('In Progress:', authEpic.statusBreakdown['In Progress']); // e.g., 5
 * console.log('Blocked:', authEpic.statusBreakdown['Blocked']); // e.g., 1
 * ```
 */
export async function querySprintEpics(
  projectZohoId: string,
  sprintZohoId:  string,
  staleDays:     number = 7,
  watchedStates: string[] = [],
): Promise<{ epics: EpicBreakdown[]; statusGroups: Record<string, 'todo' | 'doing' | 'done'> }> {
  // Fetch all data needed in parallel for efficiency
  const [dbIssues, dbEpics, project, userMap] = await Promise.all([
    prisma.issue.findMany({ where: { projectZohoId, sprintZohoId } }),
    prisma.epic.findMany({ where: { projectZohoId } }),
    prisma.project.findUnique({ where: { zohoId: projectZohoId } }),
    buildUserMap(),
  ]);

  // Parse statusGroups and orderedNames from the stored statusMap JSON
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
    } catch { /* use empty defaults, fallback to statusBreakdownRaw ordering */ }
  }

  // Build epic name lookup map for efficient O(1) lookups by zohoId
  const epicNameMap = new Map(dbEpics.map(e => [e.zohoId, e.name]));

  // Group issues by epicId (or '__unassigned__' for unassigned issues)
  // Only include issues in watched states (if configured)
  const epicIssueMap = new Map<string, typeof dbIssues>();
  for (const issue of dbIssues) {
    // Filter by watched states if configured
    const isInWatchedState = watchedStates.length === 0 || watchedStates.includes(issue.status);
    if (!isInWatchedState) continue;
    
    const key = issue.epicZohoId ?? '__unassigned__';
    if (!epicIssueMap.has(key)) epicIssueMap.set(key, []);
    epicIssueMap.get(key)!.push(issue);
  }

  const results: EpicBreakdown[] = [];

  // Process each epic group
  for (const [epicId, epicIssues] of epicIssueMap) {
    const name = epicId === '__unassigned__'
      ? 'Unassigned'
      : (epicNameMap.get(epicId) ?? `Epic ${epicId}`);

    let staleCount = 0;
    const statusBreakdownRaw: Record<string, number> = {};
    // Use Map to track unique users per epic (avoids duplicates)
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

    // Build ordered status breakdown (respect orderedNames from statusMap, zero-fill missing)
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

  // Sort epics: unassigned last, then alphabetical by name
  results.sort((a, b) => {
    if (a.id === '__unassigned__') return 1;
    if (b.id === '__unassigned__') return -1;
    return a.name.localeCompare(b.name);
  });

  return { epics: results, statusGroups };
}

/**
 * Aggregate WIP (Work In Progress) + stale counts across all active sprints per user.
 * Used by the team load page (GET /api/team/load).
 *
 * This function replaces the inefficient approach of fetching issues × N sprints.
 * Instead, it performs a single database query to fetch all active sprint issues,
 * then aggregates them in-memory by user assignee.
 *
 * Key metrics computed per user:
 * - `todo`: Issues in 'todo' status group (assigned)
 * - `doing`: Issues in 'doing' status group (assigned)  
 * - `done`: Completed issues (in 'done' status group, assigned)
 * - `stale`: Issues whose age exceeds staleDays threshold (only for assigned work)
 *
 * IMPORTANT: Only counts work the user is ASSIGNED to, not tickets they merely created.
 * This distinction is crucial: creators are surfaced separately on sprint/epic cards
 * via querySprintEpics(), which shows who raised each ticket. This function focuses
 * on assigned work load, not creation activity.
 *
 * Performance: Single DB query fetches all issues across active sprints, then O(n) in-memory
 * aggregation by assignee ID. This is dramatically faster than fetching each sprint separately.
 *
 * @param staleDays - Threshold in days for staleness calculation (default: 7)
 * @async Performs database query, returns when complete
 * @returns Object containing users array sorted by total WIP (descending) and sprint/project metadata
 *
 * @example Get team load for active sprints:
 * ```typescript
 * const teamLoad = await queryTeamLoad(7); // default staleDays = 7
 * // Result: { users: [...], sprintCount: 3, projectCount: 2 }
 * ```
 *
 * @example Calculate total team WIP (todo + doing across all users):
 * ```typescript
 * const totalWip = teamLoad.users.reduce((sum, u) => sum + u.todo + u.doing, 0);
 * console.log('Total team WIP:', totalWip); // e.g., 42 across all users
 * ```
 *
 * @example Get overloaded developers (WIP > 5):
 * ```typescript
 * const overloaded = teamLoad.users.filter(u => u.todo + u.doing > 5);
 * console.log('Overloaded:', overloaded.map(u => ({ name: u.name, load: u.todo + u.doing })));
 * ```
 *
 * @example Calculate completion rate per user:
 * ```typescript
 * const completionRates = teamLoad.users.map(u => ({
 *   name: u.name,
 *   rate: Math.round((u.done / (u.todo + u.doing)) * 100),
 * }));
 * ```
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

  // Single DB query: fetch all issues across ALL active sprints at once
  const dbIssues = await prisma.issue.findMany({
    where: { sprintZohoId: { in: activeSprintZohoIds } },
  });

  const userMap = await buildUserMap();

  // Map to accumulate counts per assignee ID
  const map = new Map<string, { id: string; name: string; role: string; todo: number; doing: number; done: number; stale: number }>();

  // Iterate through all issues, incrementing counters for each assignee
  // User Load / Completion Rate / Stale Tickets: count only ASSIGNED work,
  // not tickets that the user merely raised. Creators are surfaced on the
  // sprint/epic cards via querySprintEpics, not here.
  for (const issue of dbIssues) {
    const isStale = computeStale(issue.createdAt, issue.statusGroup, issue.status, staleDays, []);

    let parsedAssigneeIds: string[] = [];
    try { parsedAssigneeIds = JSON.parse(issue.assigneeIds) as string[]; } catch { /* empty */ }

    // Each assignee gets credit for this issue
    for (const uid of parsedAssigneeIds) {
      if (!uid || uid === '-1') continue; // Skip system assignee

      // Initialize user entry if first time seeing this assignee
      if (!map.has(uid)) {
        const u = userMap.get(uid) ?? { id: uid, name: 'Unknown', role: 'OTHER' };
        map.set(uid, { ...u, todo: 0, doing: 0, done: 0, stale: 0 });
      }

      const entry = map.get(uid)!;
      
      // Increment counters based on status group (not specific status)
      if      (issue.statusGroup === 'todo')  entry.todo++;
      else if (issue.statusGroup === 'doing') entry.doing++;
      else if (issue.statusGroup === 'done')  entry.done++;
      
      // Stale counter is independent and can apply to any status group
      if (isStale) entry.stale++;
    }
  }

  // Convert map to array and sort by total WIP (todo + doing) descending
  const users = [...map.values()].sort((a, b) =>
    (b.todo + b.doing) - (a.todo + a.doing),
  );

  // Count unique projects among active sprints
  const projectCount = new Set(activeSprints.map(s => s.projectZohoId)).size;

  return { users, sprintCount: activeSprints.length, projectCount };
}

/**
 * Fetch all issues across active sprints for a specific user.
 * Used by the user profile page (GET /api/users/:id/profile).
 *
 * This function replaces the inefficient approach of fetching issues from each sprint separately.
 * Instead, it performs a single optimized SQL query using SQLite's json_each() to efficiently
 * find issues where the user is either an assignee OR the creator.
 *
 * The SQL query uses two conditions combined with OR:
 * 1. i.creatorZohoId = ? (user is the creator)
 * 2. json_each(i.assigneeIds).value = ? (user is in the assignees JSON array)
 *
 * The DISTINCT keyword ensures issues aren't duplicated if user is both creator AND assignee.
 * Only ACTIVE sprints are queried (those scheduled to happen now or recently completed).
 *
 * The result includes contextual metadata for displaying issues:
 * - sprintId, sprintName: which sprint the issue belongs to
 * - projectId, projectName: which project contains that sprint
 *
 * @param userZohoId - The Zoho ID of the user to fetch issues for (e.g., "USER-123")
 * @param staleDays - Threshold in days for staleness calculation (default: 7)
 * @async Performs optimized SQL query with json_each, returns when complete
 * @returns Array of ContextualIssue objects with sprint/project context attached
 *
 * @example Get all issues for a specific user:
 * ```typescript
 * const myIssues = await queryUserIssues('USER-123', 7);
 * // Returns issues the user is assigned to or created across all active sprints
 * // Each issue includes sprint/project context for display in profile view
 * ```
 *
 * @example Get stale issues for a user:
 * ```typescript
 * const staleIssues = await queryUserIssues('USER-123', 5); // Override default staleDays
 * const isOverdue = staleIssues.filter(i => i.isStale);
 * console.log(`Found ${isOverdue.length} stale issues`);
 * ```
 *
 * @example Get issues for QA users (to find assigned bugs):
 * ```typescript
 * const qaIssues = await queryUserIssues('USER-456'); // QA user Zoho ID
 * const bugs = qaIssues.filter(i => /Bug|Bug/.test(i.title));
 * console.log('Bugs to review:', bugs);
 * ```
 *
 * @example Count issues per status for a user:
 * ```typescript
 * const allIssues = await queryUserIssues('USER-123');
 * const statusCounts: Record<string, number> = {};
 * allIssues.forEach(issue => {
 *   statusCounts[issue.status] = (statusCounts[issue.status] ?? 0) + 1;
 * });
 * console.log('Status breakdown:', statusCounts);
 * ```
 */
export async function queryUserIssues(
  userZohoId: string,
  staleDays:  number = 7,
  watchedStates: string[] = [],
): Promise<ContextualIssue[]> {
  const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });
  if (activeSprints.length === 0) return [];

  const activeSprintZohoIds = activeSprints.map(s => s.zohoId);

  // Build sprint lookup map for attaching context later
  const sprintByZohoId = new Map(activeSprints.map(s => [s.zohoId, s]));

  // Fetch all projects for context (needed for projectName, sprintName)
  const projectZohoIds = [...new Set(activeSprints.map(s => s.projectZohoId))];
  const projects = await prisma.project.findMany({
    where: { zohoId: { in: projectZohoIds } },
  });
  const projectByZohoId = new Map(projects.map(p => [p.zohoId, p]));

  // Raw query using json_each to find issues where user is assignee or creator
  // SQLite json_each lets us search inside the JSON array without loading all issues
  type RawIssueRow = {
    zohoId: string; sprintZohoId: string; projectZohoId: string;
    itemNo: string; title: string; status: string; statusGroup: string;
    epicZohoId: string | null; creatorZohoId: string | null;
    assigneeIds: string; createdAt: string | null; endDate: string | null;
  };

  const sprintPlaceholders = activeSprintZohoIds.map(() => '?').join(', ');
  
  // SQL query combining creator check AND assignee JSON membership check
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
    ...activeSprintZohoIds,  // All active sprint IDs for IN clause
    userZohoId,              // Creator filter value
    userZohoId,              // Assignee filter value (repeated for param binding)
  );

  const userMap = await buildUserMap();

  // Transform raw rows and attach sprint/project context
  // Filter by watched states if configured
  const issues = rawIssues.map(i => {
    const sprint  = sprintByZohoId.get(i.sprintZohoId);
    const project = projectByZohoId.get(i.projectZohoId);
    const base = toIssueItem(i, userMap, staleDays, watchedStates);
    return {
      ...base,
      sprintId:    sprint?.zohoId    ?? '',
      sprintName:  sprint?.name  ?? i.sprintZohoId,
      projectId:   project?.zohoId   ?? '',
      projectName: project?.name ?? i.projectZohoId,
    };
  });

  // Filter by watched states if configured
  if (watchedStates.length > 0) {
    return issues.filter(issue => watchedStates.includes(issue.status));
  }

  return issues;
}

/**
 * Fetch sprint-by-sprint history for a specific user.
 * Used by the user profile page to show work history across completed sprints (GET /api/users/:id/sprint-history).
 *
 * This function replaces the inefficient approach of fetching issues from each sprint separately.
 * Instead, it performs a single optimized SQL query using json_each() to count issues per sprint.
 *
 * For each completed sprint, it returns aggregate statistics:
 * - Sprint metadata (ID, name, project, status, dates)
 * - Total assigned issues count for the user in that sprint  
 * - Completed issue count (statusGroup === 'done')
 * - Completion percentage for the sprint (done / assigned * 100)
 *
 * IMPORTANT: Only includes sprints where the user had at least one assigned issue.
 * Sprints with no work from this user are excluded (reduces noise in history view).
 *
 * Results are sorted chronologically (oldest first) by default, but the DB returns
 * sprints ordered by updatedAt descending. We reverse at the end to get chronological order.
 *
 * Performance: Single SQL query fetches sprint metadata + aggregated counts using GROUP BY.
 * Much faster than N+1 queries of fetching issues per sprint.
 *
 * @param userZohoId - The Zoho ID of the user to fetch history for (e.g., "USER-123")
 * @param sprintLimit - Maximum number of recent sprints to include (default: 12)
 * @async Performs database queries, returns when complete  
 * @returns Array of SprintHistoryItem objects sorted chronologically (oldest first)
 *
 * @example Get last 6 sprints for a user:
 * ```typescript
 * const history = await queryUserSprintHistory('USER-123', 6);
 * // Returns up to 6 completed sprints where user had assigned work
 * console.log('Sprint history:', history.map(h => `${h.sprintName}: ${h.completionPct}%`));
 * ```
 *
 * @example Get current sprint completion percentage:
 * ```typescript
 * const history = await queryUserSprintHistory('USER-123', 6);
 * const lastSprint = history[history.length - 1]; // Most recent sprint in array
 * console.log('Last sprint:', lastSprint.name, 'completion:', lastSprint.completionPct + '%');
 * ```
 *
 * @example Filter by active sprints only (not completed):
 * ```typescript
 * const history = await queryUserSprintHistory('USER-123', 6);
 * const active = history.filter(h => h.status === 'active'); // Currently ongoing sprints
 * ```
 *
 * @example Calculate average completion rate over last 4 sprints:
 * ```typescript
 * const last4 = history.slice(-4); // Last 4 sprints in chronological order (end of array)
 * const avgCompletion = last4.reduce((sum, h) => sum + h.completionPct, 0);
 * console.log('Avg completion:', Math.round(avgCompletion / 4) + '%');
 * ```
 */
export async function queryUserSprintHistory(
  userZohoId:  string,
  sprintLimit: number = 12,
): Promise<SprintHistoryItem[]> {
  // Fetch recent sprints (up to sprintLimit), ordered by updatedAt descending
  const sprints = await prisma.sprint.findMany({
    orderBy: { updatedAt: 'desc' },
    take: sprintLimit,
  });

  if (sprints.length === 0) return [];

  const sprintZohoIds = sprints.map(s => s.zohoId);

  // Build project lookup map for attaching context later
  const projectZohoIds = [...new Set(sprints.map(s => s.projectZohoId))];
  const projects = await prisma.project.findMany({
    where: { zohoId: { in: projectZohoIds } },
  });
  const projectByZohoId = new Map(projects.map(p => [p.zohoId, p]));

  // Raw query to get sprint zohoId + statusGroup counts for all matching issues in one shot
  type SprintCountRow = { sprintZohoId: string; statusGroup: string; cnt: number };
  const sprintPlaceholders = sprintZohoIds.map(() => '?').join(', ');

  // SQL query using json_each to count issues per sprint for creator/assignee
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
    ...sprintZohoIds,  // All sprint IDs for IN clause
    userZohoId,        // Creator filter value
    userZohoId,        // Assignee filter value
  );

  // Aggregate counts per sprint using a Map
  const sprintStats = new Map<string, { assigned: number; done: number }>();
  for (const row of countRows) {
    if (!sprintStats.has(row.sprintZohoId)) {
      sprintStats.set(row.sprintZohoId, { assigned: 0, done: 0 });
    }
    const s = sprintStats.get(row.sprintZohoId)!;
    
    // Handle bigint from SQLite (some DB drivers return BigInt for COUNT)
    const count = typeof row.cnt === 'bigint' ? Number(row.cnt) : Number(row.cnt);
    
    s.assigned += count;
    
    // Only increment 'done' if statusGroup is 'done' (the bucket, not a specific status)
    if (row.statusGroup === 'done') s.done += count;
  }

  // Build history items — only include sprints where user had at least 1 issue
  const history: SprintHistoryItem[] = [];
  for (const sprint of sprints) {
    const stats = sprintStats.get(sprint.zohoId);
    
    // Skip sprints where user had no assigned work (avoid empty entries in history)
    if (!stats || stats.assigned === 0) continue;

    const project = projectByZohoId.get(sprint.projectZohoId);
    
    history.push({
      sprintId:      sprint.zohoId,
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

  // DB returned sprints in reverse chronological order (updatedAt desc)
  history.reverse(); // Now in chronological order (oldest first)

  return history;
}

/**
 * Backlog statistics response structure.
 * Used by the BacklogPage to display summary, oldest items, and assignee distribution.
 */
export interface BacklogStats {
  summary: {
    total: number;
    staleCount: number;
    statusGroups: {
      todo: number;
      doing: number;
      done: number;
    };
  };
  oldestItems: IssueItem[];
  assignees: Array<{
    id: string;
    name: string;
    role: string;
    count: number;
  }>;
}

/**
 * Query backlog statistics for a project.
 * 
 * Data sources:
 * - Scrum boards: issues from non-active sprints only (status = 'past' or 'future')
 * - Kanban boards: issues with statusGroup = 'todo' only
 * 
 * @param projectZohoId - The Zoho ID of the project
 * @param staleDays - Threshold in days for staleness (default: 7)
 * @param watchedStates - Array of statuses to watch for staleness
 * @async Performs database queries, returns when complete
 * @returns BacklogStats with summary, oldest items, and assignee distribution
 */
export async function queryBacklogStats(
  projectZohoId: string,
  staleDays: number = 7,
  watchedStates: string[] = [],
): Promise<BacklogStats> {
  const project = await prisma.project.findUnique({
    where: { zohoId: projectZohoId },
    select: { boardType: true, backlogZohoId: true },
  });

  if (!project) {
    return {
      summary: { total: 0, staleCount: 0, statusGroups: { todo: 0, doing: 0, done: 0 } },
      oldestItems: [],
      assignees: [],
    };
  }

  let dbIssues: Array<{
    zohoId: string;
    itemNo: string;
    title: string;
    status: string;
    statusGroup: string;
    epicZohoId: string | null;
    creatorZohoId: string | null;
    assigneeIds: string;
    createdAt: string | null;
    endDate: string | null;
  }>;

  if (project.boardType === 'kanban') {
    // Kanban: backlog = todo status group only
    dbIssues = await prisma.issue.findMany({
      where: {
        projectZohoId,
        statusGroup: 'todo',
      },
    });
  } else {
    // Scrum: backlog = issues with sprintZohoId = backlogZohoId
    const backlogProject = await prisma.project.findUnique({
      where: { zohoId: projectZohoId },
      select: { backlogZohoId: true },
    });
    if (!backlogProject?.backlogZohoId) {
      return {
        summary: { total: 0, staleCount: 0, statusGroups: { todo: 0, doing: 0, done: 0 } },
        oldestItems: [],
        assignees: [],
      };
    }

    dbIssues = await prisma.issue.findMany({
      where: {
        projectZohoId,
        sprintZohoId: backlogProject.backlogZohoId,
      },
    });
  }

  const userMap = await buildUserMap();

  const enrichedIssues: IssueItem[] = dbIssues.map(i =>
    toIssueItem(i, userMap, staleDays, watchedStates),
  );

  // Compute summary
  let staleCount = 0;
  const statusGroups = { todo: 0, doing: 0, done: 0 };
  const assigneeCounts = new Map<string, { id: string; name: string; role: string; count: number }>();

  for (const issue of enrichedIssues) {
    if (issue.isStale) staleCount++;
    statusGroups[issue.statusGroup as 'todo' | 'doing' | 'done']++;

    // Collect assignees
    for (const assignee of issue.assignees) {
      let entry = assigneeCounts.get(assignee.id);
      if (!entry) {
        entry = { id: assignee.id, name: assignee.name, role: assignee.role, count: 0 };
        assigneeCounts.set(assignee.id, entry);
      }
      entry.count++;
    }
  }

  // Sort assignees by count descending
  const assignees = [...assigneeCounts.values()].sort((a, b) => b.count - a.count);

  // Sort items by createdAt ascending (oldest first), nulls last
  const sortedByAge = [...enrichedIssues].sort((a, b) => {
    if (!a.createdAt && !b.createdAt) return 0;
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return {
    summary: {
      total: enrichedIssues.length,
      staleCount,
      statusGroups,
    },
    oldestItems: sortedByAge,
    assignees,
  };
}
