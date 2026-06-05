import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15_000,
});

// ── Status ────────────────────────────────────────────────────────────────────

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

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await apiClient.get<StatusResponse>('/status');
  return res.data;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export type UserRole = 'DEV' | 'QA' | 'PROD' | 'OTHER';

export interface User {
  id: string;
  zohoId: string;
  name: string;
  email: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export async function fetchUsers(): Promise<{ users: User[]; total: number }> {
  const res = await apiClient.get<{ users: User[]; total: number }>('/users');
  return res.data;
}

export async function syncUsers(): Promise<{ synced: number; users: User[] }> {
  const res = await apiClient.post<{ synced: number; users: User[] }>('/users/sync');
  return res.data;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
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

export async function fetchProject(id: string): Promise<{ project: Project }> {
  const res = await apiClient.get<{ project: Project }>(`/projects/${id}`);
  return res.data;
}

export async function fetchProjects(): Promise<{ projects: Project[]; total: number }> {
  const res = await apiClient.get<{ projects: Project[]; total: number }>('/projects');
  return res.data;
}

export async function syncProjects(): Promise<{ synced: number; projects: Project[] }> {
  const res = await apiClient.post<{ synced: number; projects: Project[] }>('/projects/sync');
  return res.data;
}

export async function updateProjectBoardType(id: string, boardType: string): Promise<Project> {
  const res = await apiClient.patch<{ project: Project }>(`/projects/${id}/board-type`, { boardType });
  return res.data.project;
}

export async function updateProjectDisplay(id: string, data: { hidden?: boolean; displayOrder?: number }): Promise<Project> {
  const res = await apiClient.patch<{ project: Project }>(`/projects/${id}/display`, data);
  return res.data.project;
}

export async function reorderProjects(orderedIds: string[]): Promise<void> {
  await apiClient.post('/projects/reorder', { orderedIds });
}

export async function updateUserRole(id: string, role: UserRole): Promise<User> {
  const res = await apiClient.patch<{ user: User }>(`/users/${id}/role`, { role });
  return res.data.user;
}

// ── Sprints ───────────────────────────────────────────────────────────────────

export interface SprintSnapshot {
  id: string;
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

export interface EpicBreakdown {
  id:              string;
  name:            string;
  total:           number;
  staleCount:      number;
  statusBreakdown: Record<string, number>;
  statusGroups:    Record<string, 'todo' | 'doing' | 'done'>;
  users:           { id: string; name: string; role: string }[];
}

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

export async function fetchSprintEpics(projectId: string, sprintId: string, staleDays: number = 7, watchedStates: string[] = []): Promise<{ epics: EpicBreakdown[]; statusGroups: Record<string, string> }> {
  const params: Record<string, string | number> = { staleDays };
  if (watchedStates.length) params.watchedStates = watchedStates.join(',');
  const res = await apiClient.get<{ epics: EpicBreakdown[]; statusGroups: Record<string, string> }>(`/projects/${projectId}/sprints/${sprintId}/epics`, { params });
  return res.data;
}

export async function fetchSprints(): Promise<{ sprints: SprintSnapshot[]; total: number }> {
  const res = await apiClient.get<{ sprints: SprintSnapshot[]; total: number }>('/sprints');
  return res.data;
}

export async function syncSprints(): Promise<{ synced: number; sprints: SprintSnapshot[] }> {
  const res = await apiClient.post<{ synced: number; sprints: SprintSnapshot[] }>('/sprints/sync');
  return res.data;
}

export async function fetchAppConfig(): Promise<{ workspaceName: string }> {
  const res = await apiClient.get<{ workspaceName: string }>('/config');
  return res.data;
}

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

export interface UserLoadStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
  stale: number;
}

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

export interface RaiserStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
}

export async function fetchRaiserStats(
  projectId: string,
  sprintId:  string,
): Promise<RaiserStat[]> {
  const res = await apiClient.get<{ raisers: RaiserStat[] }>(
    `/projects/${projectId}/sprints/${sprintId}/raiser-stats`,
  );
  return res.data.raisers;
}

export interface TeamLoadStat {
  id:    string;
  name:  string;
  role:  string;
  todo:  number;
  doing: number;
  done:  number;
  stale: number;
}

export interface TeamLoadResponse {
  users:        TeamLoadStat[];
  sprintCount:  number;
  projectCount: number;
  staleDays:    number;
}

export async function fetchTeamLoad(staleDays: number = 7): Promise<TeamLoadResponse> {
  const res = await apiClient.get<TeamLoadResponse>('/team/load', { params: { staleDays } });
  return res.data;
}

export interface ProfileIssue extends IssueItem {
  sprintId:    string;
  sprintName:  string;
  projectId:   string;
  projectName: string;
}

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

export interface UserProfileResponse {
  user:         { id: string; zohoId: string; name: string; email: string | null; role: string };
  issues:       ProfileIssue[];
  raisedIssues: ProfileIssue[];
  summary:      UserProfileSummary;
  sprintCount:  number;
  staleDays:    number;
}

export async function fetchUserProfile(userId: string, staleDays: number = 7): Promise<UserProfileResponse> {
  const res = await apiClient.get<UserProfileResponse>(`/users/${userId}/profile`, { params: { staleDays } });
  return res.data;
}

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

export async function fetchUserSprintHistory(userId: string, limit: number = 12): Promise<{ history: SprintHistoryItem[]; total: number }> {
  const res = await apiClient.get<{ history: SprintHistoryItem[]; total: number }>(`/users/${userId}/sprint-history`, { params: { limit } });
  return res.data;
}
