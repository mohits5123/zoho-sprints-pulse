import axios from 'axios';

/**
 * API client for the Engineering Delivery Intelligence Dashboard.
 *
 * @remarks
 * This module provides all API client functions for communicating with the backend.
 * All requests are made relative to `/api`, which is handled by the Vite dev server proxy.
 *
 * **Architecture note:** Runtime API calls serve from local SQLite database (backend routes).
 * Zoho API calls only occur during scheduled syncs (cron or manual sync triggers).
 *
 * All endpoints follow REST conventions with the following patterns:
 * - GET `/status` - Check connection status
 * - GET `/users` - Fetch users list
 * - POST `/users/sync` - Trigger user sync
 * - GET `/projects` - Fetch projects list
 * - POST `/projects/sync` - Trigger project sync
 * - GET `/sprints` - Fetch sprints list
 * - POST `/sprints/sync` - Trigger sprint sync
 * - GET `/team/load` - Fetch team workload statistics
 * - GET `/config` - Fetch app configuration
 * - GET `/sync/status` - Fetch last sync timestamp
 *
 * @example
 * Create an Axios instance to use as apiClient for all API calls:
 * ```typescript
 * const apiClient = axios.create({ baseURL: '/api', timeout: 10000 });
 * ```
 */

// Axios client instance for all API requests
const apiClient = axios.create({ baseURL: '/api', timeout: 15000 });

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Status response from the backend.
 * Contains connection state and authentication token expiry information.
 */
export interface StatusResponse {
  connected: boolean;
  tokenExpiresAt?: string;
  myTeamId?: string;
  defaultPortalId?: string;
  portals?: Array<{ zsoid: string; name: string; orgName: string; type: string }>;
  error?: string;
  zohoStatus?: number;
  zohoUrl?: string;
}

/**
 * Fetch the current connection status and authentication state.
 *
 * @returns Authentication status including token expiry, team ID, portal information, and Zoho service status.
 *
 * @remarks
 * This endpoint checks if the Zoho OAuth token is valid and retrieves connection metadata.
 * The `tokenExpiresAt` field indicates when the refresh token will expire (auto-refresh occurs 5 minutes before expiry).
 */
export async function fetchStatus(): Promise<StatusResponse> {
  const res = await apiClient.get<StatusResponse>('/status');
  return res.data;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * User role types for team members.
 * DEV - Developers, QA - Testers, PROD - Product Owners, OTHER - Other roles.
 */
export type UserRole = 'DEV' | 'QA' | 'PROD' | 'OTHER';

/**
 * User profile information from Zoho/Sprints.
 *
 * @remarks
 * The `role` field can be modified via the backend API (PATCH /api/users/:id/role).
 * This is a locally-mutable field not sourced from Zoho.
 */
export interface User {
  zohoId: string;
  name: string;
  email: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fetch all users from the local database.
 *
 * @returns Users array with pagination metadata.
 *
 * @remarks
 * This endpoint reads from the local SQLite database (served through the backend).
 * No Zoho API calls are made during runtime data fetching.
 */
export async function fetchUsers(): Promise<{ users: User[]; total: number }> {
  const res = await apiClient.get<{ users: User[]; total: number }>('/users');
  return res.data;
}

/**
 * Trigger a full sync of users from Zoho Sprints.
 *
 * @returns Number of users synced and the updated users array.
 *
 * @remarks
 * This is a fire-and-forget sync operation that runs in the background.
 * Users are upserted based on their Zoho ID to maintain data consistency.
 */
export async function syncUsers(): Promise<{ synced: number; users: User[] }> {
  const res = await apiClient.post<{ synced: number; users: User[] }>('/users/sync');
  return res.data;
}

// ── Projects ──────────────────────────────────────────────────────────────────

/**
 * Project information from Zoho Sprints.
 *
 * @remarks
 * Projects have several locally-mutable fields that can be modified via the API:
 * - `boardType`: set via PATCH /api/projects/:id/board-type
 * - `hidden`: visibility flag set via PATCH /api/projects/:id/display
 * - `displayOrder`: ordering index set via PATCH /api/projects/:id/display
 *
 * The `activeSprints` field contains snapshots of currently active sprints for this project.
 */
export interface Project {
  zohoId: string;
  name: string;
  prefix: string | null;
  projNo: string | null;
  status: string;
  boardType: string;
  description: string | null;
  ownerName: string | null;
  ownerZohoId: string | null;
  createdTime: string | null;
  backlogCount: number | null;
  displayOrder: number;
  hidden: boolean;
  statusBreakdown: string | null;
  statusGroups: string | null;
  createdAt: string;
  updatedAt: string;
  activeSprints: SprintSnapshot[];
}

/**
 * Fetch a single project by ID.
 *
 * @param id - The unique identifier of the project to fetch.
 *
 * @returns Project data with active sprints.
 */
export async function fetchProject(id: string): Promise<{ project: Project }> {
  const res = await apiClient.get<{ project: Project }>(`/projects/${id}`);
  return res.data;
}

/**
 * Fetch all projects from the local database.
 *
 * @returns Projects array with pagination metadata.
 *
 * @remarks
 * Projects are sorted by `displayOrder` (ascending) for UI presentation.
 */
export async function fetchProjects(): Promise<{ projects: Project[]; total: number }> {
  const res = await apiClient.get<{ projects: Project[]; total: number }>('/projects');
  return res.data;
}

/**
 * Trigger a full sync of projects from Zoho Sprints.
 *
 * @returns Number of projects synced and the updated projects array.
 *
 * @remarks
 * Projects are upserted based on their Zoho ID.
 * Sync includes project metadata and active sprint snapshots.
 */
export async function syncProjects(): Promise<{ synced: number; projects: Project[] }> {
  const res = await apiClient.post<{ synced: number; projects: Project[] }>('/projects/sync');
  return res.data;
}

/**
 * Update the board type for a project.
 *
 * @param id - The unique identifier of the project.
 * @param boardType - The new board type ('scrum' | 'kanban' | 'other').
 *
 * @returns Updated Project with the new board type.
 *
 * @remarks
 * Board type affects how issues are displayed and organized in the project view.
 */
export async function updateProjectBoardType(id: string, boardType: string): Promise<Project> {
  const res = await apiClient.patch<{ project: Project }>(`/projects/${id}/board-type`, { boardType });
  return res.data.project;
}

/**
 * Update project display settings (hidden status and display order).
 *
 * @param id - The unique identifier of the project.
 * @param data - Object containing optional `hidden` (boolean) and `displayOrder` (number) fields.
 *
 * @returns Updated Project with the new display settings.
 *
 * @remarks
 * This endpoint allows controlling project visibility and ordering in the UI.
 * Hidden projects are excluded from the main projects list.
 */
export async function updateProjectDisplay(id: string, data: { hidden?: boolean; displayOrder?: number }): Promise<Project> {
  const res = await apiClient.patch<{ project: Project }>(`/projects/${id}/display`, data);
  return res.data.project;
}

/**
 * Reorder projects by setting their display order.
 *
 * @param orderedIds - Array of project Zoho IDs in the desired order.
 *
 * @remarks
 * Projects are reordered by sorting them by `displayOrder` (ascending) in the UI.
 * The backend updates the displayOrder values to match the requested sequence.
 */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  await apiClient.post('/projects/reorder', { orderedIds });
}

/**
 * Update a user's role.
 *
 * @param id - The unique identifier of the user.
 * @param role - The new role ('DEV' | 'QA' | 'PROD' | 'OTHER').
 *
 * @returns Updated User with the new role.
 *
 * @remarks
 * Role changes are local modifications not propagated to Zoho.
 */
export async function updateUserRole(id: string, role: UserRole): Promise<User> {
  const res = await apiClient.patch<{ user: User }>(`/users/${id}/role`, { role });
  return res.data.user;
}

// ── Sprints ───────────────────────────────────────────────────────────────────

/**
 * Sprint snapshot representing a sprint's state in the local database.
 *
 * @remarks
 * Sprints are stored as snapshots with a `rawData` field containing the full
 * Zoho response (serialized JSON). This enables re-fetching detailed sprint data
 * without additional Zoho API calls.
 *
 * The `statusBreakdown` field is a JSON string mapping issue statuses to counts.
 * The `rawData` field contains the complete status groups structure.
 */
export interface SprintSnapshot {
  zohoId: string;
  projectZohoId: string;
  projectName: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  totalTickets: number;
  statusBreakdown: string | null; // JSON string
  rawData: string | null;         // JSON string, contains statusGroups
  createdAt: string;
  updatedAt: string;
}

/**
 * Epic breakdown showing issue distribution across statuses.
 *
 * @remarks
 * Used for displaying epic-level metrics in sprint views.
 * The `statusGroups` field maps statuses to their bucket ('todo' | 'doing' | 'done').
 * The `users` array lists all assignees associated with issues in this epic.
 */
export interface EpicBreakdown {
  id:              string;
  name:            string;
  total:           number;
  staleCount:      number;
  statusBreakdown: Record<string, number>;
  statusGroups:    Record<string, 'todo' | 'doing' | 'done'>;
  users:           { id: string; name: string; role: string }[];
}

/**
 * Individual issue item within a sprint.
 *
 * @remarks
 * Issues are computed with derived fields:
 * - `isStale`: true if last update exceeds `staleDays` threshold (default 7 days)
 * - `delayedDays`: number of days overdue relative to endDate
 *
 * Both fields are computed at query time from `createdAt` and `endDate`.
 */
export interface IssueItem {
  zohoId:      string;
  itemNo:      string;
  title:       string;
  status:      string;
  statusGroup: string;
  creator:     { id: string; name: string; role: string } | null;
  assignees:   { id: string; name: string; role: string }[];
  createdAt:   string | null;
  endDate:     string | null;
  delayedDays: number;
  isStale:     boolean;
}

/**
 * Fetch issues from a specific sprint with optional filtering.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 * @param opts - Optional filter parameters.
 *
 * @returns Array of issues matching the filters.
 *
 * @remarks
 * Available filters:
 * - `status`: Filter by issue status (e.g., 'To Do', 'In Progress')
 * - `statusGroup`: Filter by work bucket ('todo', 'doing', 'done')
 * - `epicId`: Filter by epic ID
 * - `userId`: Filter by assignee ID (uses JSON query on assigneeIds)
 * - `creatorOnly`: If true, only return issues created by the user
 * - `stale`: If true, only return stale issues
 * - `staleDays`: Override the default stale threshold (default 7 days)
 * - `watchedStates`: Comma-separated list of statuses to watch
 *
 * Issues are queried from the local SQLite database via issueQueries.ts.
 */
export async function fetchIssues(
  projectId: string,
  sprintId:  string,
  opts: { status?: string; statusGroup?: string; epicId?: string; userId?: string; creatorOnly?: boolean; stale?: boolean; staleDays?: number; watchedStates?: string[] } = {},
): Promise<{ issues: IssueItem[] }> {
  const params: Record<string, string | number> = {};
  if (opts.status)         params.status        = opts.status;
  if (opts.statusGroup)    params.statusGroup   = opts.statusGroup;
  if (opts.epicId)         params.epicId        = opts.epicId;
  if (opts.userId)         params.userId        = opts.userId;
  if (opts.creatorOnly)    params.creatorOnly   = 'true';
  if (opts.stale)          params.stale         = 'true';
  if (opts.staleDays)      params.staleDays     = opts.staleDays;
  if (opts.watchedStates?.length) params.watchedStates = opts.watchedStates.join(',');
  const res = await apiClient.get<{ issues: IssueItem[] }>(`/projects/${projectId}/sprints/${sprintId}/issues`, { params });
  return res.data;
}

/**
 * Fetch issues for a kanban board with optional filtering.
 *
 * @param projectId - The Zoho ID of the kanban project.
 * @param opts - Optional filter parameters.
 *
 * @returns Array of issues matching the filters.
 *
 * @remarks
 * Kanban boards don't have sprints - issues flow continuously through status groups.
 * Available filters:
 * - `status`: Filter by issue status (e.g., 'To Do', 'In Progress')
 * - `statusGroup`: Filter by work bucket ('todo', 'doing', 'done')
 * - `epicId`: Filter by epic ID
 * - `userId`: Filter by assignee ID (uses JSON query on assigneeIds)
 * - `creatorOnly`: If true, only return issues created by the user
 * - `stale`: If true, only return stale issues
 * - `staleDays`: Override the default stale threshold (default 7 days)
 * - `watchedStates`: Comma-separated list of statuses to watch
 *
 * Issues are queried from the local SQLite database via issueQueries.ts.
 */
export async function fetchIssuesKanban(
  projectId: string,
  opts: { status?: string; statusGroup?: string; epicId?: string; userId?: string; creatorOnly?: boolean; stale?: boolean; staleDays?: number; watchedStates?: string[] } = {},
): Promise<{ issues: IssueItem[] }> {
  const params: Record<string, string | number> = {};
  if (opts.status)         params.status        = opts.status;
  if (opts.statusGroup)    params.statusGroup   = opts.statusGroup;
  if (opts.epicId)         params.epicId        = opts.epicId;
  if (opts.userId)         params.userId        = opts.userId;
  if (opts.creatorOnly)    params.creatorOnly   = 'true';
  if (opts.stale)          params.stale         = 'true';
  if (opts.staleDays)      params.staleDays     = opts.staleDays;
  if (opts.watchedStates?.length) params.watchedStates = opts.watchedStates.join(',');
  const res = await apiClient.get<{ issues: IssueItem[] }>(`/projects/${projectId}/kanban/issues`, { params });
  return res.data;
}

/**
 * Fetch stale count for a kanban board.
 *
 * @param projectId - The Zoho ID of the kanban project.
 * @param opts - Optional filter parameters.
 *
 * @returns Object with stale count.
 *
 * @remarks
 * Kanban boards don't have sprints - issues flow continuously through status groups.
 * This endpoint returns only the count of unique stale issues.
 * Available filters:
 * - `staleDays`: Override the default stale threshold (default 7 days)
 * - `watchedStates`: Comma-separated list of statuses to watch
 */
export async function fetchKanbanStaleCount(
  projectId: string,
  opts: { staleDays?: number; watchedStates?: string[] } = {},
): Promise<{ staleCount: number }> {
  const params: Record<string, string | number> = {};
  if (opts.staleDays)      params.staleDays     = opts.staleDays;
  if (opts.watchedStates?.length) params.watchedStates = opts.watchedStates.join(',');
  const res = await apiClient.get<{ staleCount: number }>(`/projects/${projectId}/kanban/stale-count`, { params });
  return res.data;
}

/**
 * Fetch epics with their issue breakdown for a sprint.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 * @param staleDays - Threshold for considering issues stale (default 7 days).
 * @param watchedStates - Array of statuses to include in the breakdown.
 *
 * @returns Array of epics with issue counts and status groupings.
 *
 * @remarks
 * Each epic includes:
 * - Total issue count
 * - Stale issue count
 * - Status breakdown (by status)
 * - Status groups (todo/doing/done mapping)
 * - Assignee list
 */
export async function fetchSprintEpics(projectId: string, sprintId: string, staleDays: number = 7, watchedStates: string[] = []): Promise<{ epics: EpicBreakdown[]; statusGroups: Record<string, string> }> {
  const params: Record<string, string | number> = { staleDays };
  if (watchedStates.length) params.watchedStates = watchedStates.join(',');
  const res = await apiClient.get<{ epics: EpicBreakdown[]; statusGroups: Record<string, string> }>(`/projects/${projectId}/sprints/${sprintId}/epics`, { params });
  return res.data;
}

/**
 * Fetch all sprints from the local database.
 *
 * @returns Array of sprint snapshots with pagination metadata.
 *
 * @remarks
 * Sprints are ordered by start date (most recent first) for sprint health views.
 */
export async function fetchSprints(): Promise<{ sprints: SprintSnapshot[]; total: number }> {
  const res = await apiClient.get<{ sprints: SprintSnapshot[]; total: number }>('/sprints');
  return res.data;
}

/**
 * Trigger a full sync of sprints from Zoho Sprints.
 *
 * @returns Number of sprints synced and the updated sprints array.
 *
 * @remarks
 * This is an alias for the full sync operation.
 * Sprints are upserted based on their Zoho ID.
 */
export async function syncSprints(): Promise<{ synced: number; sprints: SprintSnapshot[] }> {
  const res = await apiClient.post<{ synced: number; sprints: SprintSnapshot[] }>('/sprints/sync');
  return res.data;
}

/**
 * Fetch application configuration.
 *
 * @returns Workspace name configured for the dashboard.
 */
export async function fetchAppConfig(): Promise<{ workspaceName: string }> {
  const res = await apiClient.get<{ workspaceName: string }>('/config');
  return res.data;
}

/**
 * Fetch the last sync timestamp.
 *
 * @returns Last successful sync timestamp, or null if never synced.
 *
 * @remarks
 * Used by the UI to show sync status and elapsed time since last sync.
 */
export async function fetchSyncStatus(): Promise<{ lastSyncedAt: string | null }> {
  const res = await apiClient.get<{ lastSyncedAt: string | null }>('/sync/status');
  return res.data;
}



export interface BurndownPoint {
  date:       string; // YYYY-MM-DD
  doneCount:  number;
  totalCount: number;
}

export async function fetchBurndownData(
  sprintZohoId: string,
  seed?: { doneCount: number; totalCount: number },
): Promise<BurndownPoint[]> {
  const params = seed ? { doneCount: seed.doneCount, totalCount: seed.totalCount } : {};
  const res = await apiClient.get<{ snapshots: BurndownPoint[] }>(
    `/sprints/${sprintZohoId}/burndown`,
    { params },
  );
  return res.data.snapshots;
}

/**
 * Fetch user workload statistics for a sprint.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 * @param watchedStates - Array of statuses to include in the calculation.
 *
 * @returns Array of users with their issue counts by status group, plus total stale issues.
 *
 * @remarks
 * Used for the User Load card to display developer workload distribution.
 * Each user has counts for todo, doing, done, and stale issues.
 */
export interface UserLoadStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
  stale: number;
}

/**
 * Fetch user workload statistics.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 * @param watchedStates - Array of statuses to include in the calculation.
 *
 * @returns Array of user stats and total stale issue count.
 */
export async function fetchUserStats(
  projectId: string,
  sprintId:  string,
  staleDays: number = 7,
  watchedStates: string[] = [],
): Promise<{ users: UserLoadStat[]; totalStaleIssues: number }> {
  const params: Record<string, string | number> = { staleDays };
  if (watchedStates.length) params.watchedStates = watchedStates.join(',');
  const res = await apiClient.get<{ users: UserLoadStat[]; totalStaleIssues: number }>(
    `/projects/${projectId}/sprints/${sprintId}/user-stats`,
    { params },
  );
  return res.data;
}

/**
 * Fetch user workload statistics for a kanban board.
 *
 * @param projectId - The Zoho ID of the kanban project.
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 * @param watchedStates - Array of statuses to include in the calculation.
 * @param userId - Optional: filter by specific user (creator or assignee).
 * @param creatorOnly - If true, only return issues created by the user.
 *
 * @returns Array of user stats and total stale issue count.
 *
 * @remarks
 * Kanban boards don't have sprints - issues flow continuously through status groups.
 * This function aggregates workload by assignee for all issues in the project.
 */
export async function fetchKanbanUserStats(
  projectId: string,
  staleDays: number = 7,
  watchedStates: string[] = [],
  userId?: string,
  creatorOnly?: boolean,
): Promise<{ users: UserLoadStat[]; totalStaleIssues: number }> {
  const params: Record<string, string | number> = { staleDays };
  if (watchedStates.length) params.watchedStates = watchedStates.join(',');
  if (userId) params.userId = userId;
  if (creatorOnly) params.creatorOnly = 'true';
  const res = await apiClient.get<{ users: UserLoadStat[]; totalStaleIssues: number }>(
    `/projects/${projectId}/kanban-user-stats`,
    { params },
  );
  return res.data;
}

/**
 * Fetch issue creator statistics for a sprint.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 *
 * @returns Array of users with their issue counts by status group.
 *
 * @remarks
 * Used for displaying who raised the most issues in a sprint.
 * Does not count stale issues.
 */
export interface RaiserStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
}

/**
 * Fetch issue raiser statistics.
 *
 * @param projectId - The Zoho ID of the project.
 * @param sprintId - The Zoho ID of the sprint.
 *
 * @returns Array of users with their issue counts by status group (todo, doing, done).
 *
 * @remarks
 * Shows which users raised the most issues in a sprint.
 * Does not count stale issues.
 */
export async function fetchRaiserStats(
  projectId: string,
  sprintId:  string,
): Promise<RaiserStat[]> {
  const res = await apiClient.get<{ raisers: RaiserStat[] }>(
    `/projects/${projectId}/sprints/${sprintId}/raiser-stats`,
  );
  return res.data.raisers;
}

/**
 * Fetch issue raiser statistics for kanban boards (no sprint scope).
 *
 * @param projectId - The project's primary DB id.
 *
 * @returns Array of users with their issue counts by status group (todo, doing, done).
 *
 * @remarks
 * Shows which users raised the most issues across the entire kanban board.
 * Does not count stale issues.
 */
export async function fetchKanbanRaiserStats(
  projectId: string,
): Promise<RaiserStat[]> {
  const res = await apiClient.get<{ raisers: RaiserStat[] }>(
    `/projects/${projectId}/kanban-raiser-stats`,
  );
  return res.data.raisers;
}

/**
 * Fetch team-wide workload statistics across all projects and sprints.
 *
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 *
 * @returns Team load statistics including per-user counts and aggregate metrics.
 *
 * @remarks
 * Used for the Team Load card to display overall team capacity and bottlenecks.
 * Aggregates across all visible (non-hidden) projects and active sprints.
 */
export interface TeamLoadStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
  stale: number;
}

/**
 * Response interface for team load statistics.
 */
export interface TeamLoadResponse {
  users:        TeamLoadStat[];
  sprintCount:  number;
  projectCount: number;
  staleDays:    number;
}

/**
 * Fetch team load statistics.
 */
export async function fetchTeamLoad(staleDays: number = 7): Promise<TeamLoadResponse> {
  const res = await apiClient.get<TeamLoadResponse>('/team/load', { params: { staleDays } });
  return res.data;
}

/**
 * Profile issue with additional sprint and project context.
 * Extends IssueItem with sprint/project metadata.
 */
export interface ProfileIssue extends IssueItem {
  sprintId:    string;
  sprintName:  string;
  projectId:   string;
  projectName: string;
}

/**
 * Summary of a user's issue distribution across all sprints.
 *
 * @remarks
 * Used for the user profile page to show aggregate statistics.
 * - `collab`: count of issues created by others assigned to this user
 * - `raised`: count of issues created by this user
 */
export interface UserProfileSummary {
  total:   number;
  todo:    number;
  doing:   number;
  done:    number;
  stale:   number;
  overdue: number;
  collab:  number;
  raised:  number;
}

/**
 * Response interface for user profile summary.
 *
 * @remarks
 * Includes the user's profile data, their issues, and aggregate statistics.
 * The `staleDays` parameter is echoed back for use in filters.
 */
export interface UserProfileResponse {
  user:         { id: string; zohoId: string; name: string; email: string | null; role: string };
  issues:       ProfileIssue[];
  raisedIssues: ProfileIssue[];
  summary:      UserProfileSummary;
  sprintCount:  number;
  staleDays:    number;
}

/**
 * Fetch a user's complete profile with all their issues.
 *
 * @param userId - The user ID to fetch profile for.
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 *
 * @returns User profile with issues, raised issues, and summary statistics.
 *
 * @remarks
 * Used for the user profile page (UserProfilePage).
 * Returns all issues assigned to the user plus issues they created.
 */
export async function fetchUserProfile(userId: string, staleDays: number = 7): Promise<UserProfileResponse> {
  const res = await apiClient.get<UserProfileResponse>(`/users/${userId}/profile`, { params: { staleDays } });
  return res.data;
}

/**
 * Sprint history item showing completion metrics.
 */
export interface SprintHistoryItem {
  sprintId:      string;
  sprintName:    string;
  projectName:   string;
  status:        string;
  startDate:     string | null;
  endDate:       string | null;
  assigned:      number;
  done:          number;
  completionPct: number;
}

/**
 * Fetch a user's sprint history.
 *
 * @param userId - The user ID to fetch history for.
 * @param limit - Maximum number of sprints to return (default 12).
 *
 * @returns Array of sprint history items with completion percentages.
 *
 * @remarks
 * Used for displaying a user's contribution history across sprints.
 * Shows tasks they were assigned to, completion status, and sprint outcomes.
 */
export async function fetchUserSprintHistory(userId: string, limit: number = 12): Promise<{ history: SprintHistoryItem[]; total: number }> {
  const res = await apiClient.get<{ history: SprintHistoryItem[]; total: number }>(`/users/${userId}/sprint-history`, { params: { limit } });
  return res.data;
}

/**
 * Backlog statistics response from the backend.
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
 * Fetch backlog statistics for a project.
 *
 * @param projectId - The project's primary DB id.
 * @param staleDays - Threshold for counting stale issues (default 7 days).
 * @param watchedStates - Comma-separated list of statuses to watch for staleness.
 *
 * @returns Backlog statistics including summary, oldest items, and assignee distribution.
 *
 * @remarks
 * Used for the BacklogPage to display backlog overview.
 * Scrum: non-active sprint issues. Kanban: todo status group only.
 */
export async function fetchBacklogStats(
  projectId: string,
  staleDays: number = 7,
  watchedStates: string[] = [],
): Promise<BacklogStats> {
  const params: Record<string, string | number | undefined> = { staleDays };
  if (watchedStates.length > 0) {
    params.watchedStates = watchedStates.join(',');
  }
  const res = await apiClient.get<BacklogStats>(`/projects/${projectId}/backlog-stats`, { params });
  return res.data;
}
