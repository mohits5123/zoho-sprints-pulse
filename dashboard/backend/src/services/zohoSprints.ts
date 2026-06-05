import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { recordBurndownSnapshot } from './burndownSnapshots';
import { zohoThrottle } from './rateLimiter';

const SETTINGS_KEY_TEAM_ID = 'zoho_team_id';

// ── In-memory caches ──────────────────────────────────────────────────────────
// statusMapCache: permanent entries (cleared only at sync start via clearZohoCache)
// — statusMap is fetched from Zoho during sync only, then persisted to DB.
//   Non-sync callers read from DB (or in-memory if already loaded this session).

interface StatusMapResult {
  map:          Record<string, string>;
  orderedNames: string[];
  statusGroups: Record<string, 'todo' | 'doing' | 'done'>;
}
const statusMapCache = new Map<string, StatusMapResult>();

export async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;
  throw new Error('Team ID not found. Run user sync first.');
}

// ── Sprint fetching ───────────────────────────────────────────────────────────

interface SprintRaw {
  zohoId: string;
  name: string;
  status: string;
  statusCode: number;
  startDate: string | null;
  endDate: string | null;
}

async function fetchSprintsForProject(teamId: string, projectZohoId: string): Promise<SprintRaw[]> {
  const token = getAccessToken();
  const url   = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/`;

  // Only fetch active/running sprints (type=[2])
  let res;
  try {
    await zohoThrottle.wait(`sprints/${projectZohoId}`);
    res = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', type: '[2]', index: 1, range: 50 },
    });
    zohoThrottle.record(res.status);
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return [];
  }

  const raw = res.data as Record<string, unknown>;
  const sprintIds: string[] = (raw?.sprintIds as string[] | undefined) ?? [];
  if (sprintIds.length === 0) return [];
  const sprintJObj = raw!.sprintJObj as Record<string, unknown[]>;
  const prop       = (raw!.sprint_prop as Record<string, number>) ?? {};

  const nameIdx       = prop.sprintName ?? 0;
  const startIdx      = prop.startDate  ?? 1;
  const endIdx        = prop.endDate    ?? 2;

  const allSprints: SprintRaw[] = [];
  for (const id of sprintIds) {
    const f = sprintJObj?.[id];
    if (!f) continue;
    allSprints.push({
      zohoId:     id,
      name:       String(f[nameIdx] ?? 'Sprint').trim(),
      status:     'active',
      statusCode: 2,
      startDate:  String(f[startIdx] ?? '-1') === '-1' ? null : String(f[startIdx]),
      endDate:    String(f[endIdx]   ?? '-1') === '-1' ? null : String(f[endIdx]),
    });
  }
  return allSprints;
}

// ── Ticket / item fetching ────────────────────────────────────────────────────

// Parses raw Zoho /itemstatus/ response into a StatusMapResult
function parseStatusMapResponse(raw: Record<string, unknown>): StatusMapResult {
  const statusJObj = raw?.statusJObj as Record<string, unknown[]> | undefined;
  const prop       = (raw?.status_prop as Record<string, number>) ?? {};
  const statusIds: string[] = (raw?.statusIds as string[] | undefined) ?? [];
  if (!statusJObj) return { map: {}, orderedNames: [], statusGroups: {} };

  const nameIdx = prop.statusName ?? 0;
  const typeIdx = prop.statusType ?? 4; // 0=todo, 2=doing, 1=done
  const TYPE_MAP: Record<number, 'todo' | 'doing' | 'done'> = { 0: 'todo', 2: 'doing', 1: 'done' };

  const map: Record<string, string> = {};
  const statusGroups: Record<string, 'todo' | 'doing' | 'done'> = {};
  for (const [id, fields] of Object.entries(statusJObj)) {
    const name = String(fields[nameIdx] ?? 'Unknown').trim();
    const typeCode = typeof fields[typeIdx] === 'number' ? (fields[typeIdx] as number) : 0;
    map[id] = name;
    statusGroups[name] = TYPE_MAP[typeCode] ?? 'todo';
  }
  const orderedNames = statusIds.map(id => map[id]).filter((n): n is string => Boolean(n));
  return { map, orderedNames, statusGroups };
}

/**
 * Fetch status map from Zoho and persist to DB.
 * Called ONLY by syncAll — never by runtime API handlers.
 */
async function fetchStatusMapFromZoho(teamId: string, projectZohoId: string): Promise<StatusMapResult> {
  const token = getAccessToken();
  const url   = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/itemstatus/`;

  await zohoThrottle.wait(`statusMap/${projectZohoId}`);
  const res = await axios.get(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    params: { action: 'data' },
  });
  zohoThrottle.record(res.status);

  const result = parseStatusMapResponse(res.data as Record<string, unknown>);

  // Persist to DB so runtime callers never need to call Zoho for this
  await prisma.project.update({
    where: { zohoId: projectZohoId },
    data:  { statusMap: JSON.stringify(result) },
  });

  // Populate in-memory cache (permanent until clearZohoCache at next sync)
  const cacheKey = `${teamId}:${projectZohoId}`;
  statusMapCache.set(cacheKey, result);

  return result;
}

/**
 * DB-first status map lookup. Order: in-memory cache → DB → Zoho (first-run fallback only).
 * After the first sync this never calls Zoho.
 */
async function fetchStatusMap(teamId: string, projectZohoId: string): Promise<StatusMapResult> {
  const cacheKey = `${teamId}:${projectZohoId}`;
  const cached = statusMapCache.get(cacheKey);
  if (cached) return cached;

  // Load from DB (populated during sync)
  const project = await prisma.project.findUnique({
    where:  { zohoId: projectZohoId },
    select: { statusMap: true },
  });
  if (project?.statusMap) {
    const result = JSON.parse(project.statusMap) as StatusMapResult;
    statusMapCache.set(cacheKey, result);
    return result;
  }

  // First-run fallback — no sync has run yet for this project
  return fetchStatusMapFromZoho(teamId, projectZohoId);
}

async function fetchItemsForSprint(
  teamId: string,
  projectZohoId: string,
  sprintId: string,
  statusMap: Record<string, string>
): Promise<Record<string, number>> {
  const token = getAccessToken();
  // Correct endpoint: singular /item/ not /items/
  const url   = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/${sprintId}/item/`;

  const statusCounts: Record<string, number> = {};
  let index = 1;
  const RANGE = 100;

  while (true) {
    let res;
    try {
      await zohoThrottle.wait(`items/${sprintId}/p${index}`);
      res = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { action: 'data', index, range: RANGE },
      });
      zohoThrottle.record(res.status);
    } catch (err) {
      zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
      break;
    }

    const raw = res.data;
    // `itemIds: []` means sprint exists but has 0 tickets — valid empty response
    const itemIds: string[] = raw?.itemIds ?? [];
    const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;

    if (!itemJObj && Array.isArray(raw?.itemIds)) {
      break;
    }

    if (itemJObj) {
      const resolvedIds: string[] = raw?.itemIds ?? Object.keys(itemJObj);

      const prop      = raw?.item_prop as Record<string, number> ?? {};
      const statusIdx = prop.statusId ?? prop.status ?? prop.itemStatus ?? -1;

      for (const id of resolvedIds) {
        const f = itemJObj[id];
        if (!f) continue;

        const rawStatus   = statusIdx >= 0 && f[statusIdx] !== undefined ? String(f[statusIdx]) : '';
        const statusLabel = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
        statusCounts[statusLabel] = (statusCounts[statusLabel] ?? 0) + 1;
      }

      if (!raw.next || resolvedIds.length < RANGE) break;
    } else {
      break;
    }

    index += RANGE;
  }

  return statusCounts;
}

// ── Backlog fetching ─────────────────────────────────────────────────────────

interface BacklogResult {
  count: number;
  statusCounts: Record<string, number>;
  backlogId: string;
}

async function fetchBacklogItems(
  teamId: string,
  projectZohoId: string,
  statusMap: Record<string, string>
): Promise<BacklogResult | null> {
  const token = getAccessToken();
  const baseUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/`;

  try {
    await zohoThrottle.wait(`backlog-id/${projectZohoId}`);
    const backlogRes = await axios.get(baseUrl, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'getbacklog' },
    });
    zohoThrottle.record(backlogRes.status);
    const backlogId: string | undefined = backlogRes.data?.backlogId;
    if (!backlogId) {
      return null;
    }

    const itemsUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/${backlogId}/item/`;
    const statusCounts: Record<string, number> = {};
    let total = 0;
    let index = 1;
    const RANGE = 100;

    while (true) {
      await zohoThrottle.wait(`backlog-items/${projectZohoId}/p${index}`);
      const res = await axios.get(itemsUrl, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { action: 'data', index, range: RANGE },
      });
      zohoThrottle.record(res.status);
      const raw = res.data;
      const itemIds: string[] = raw?.itemIds ?? [];
      total += itemIds.length;

      const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;
      if (itemJObj && itemIds.length > 0) {
        const prop      = raw?.item_prop as Record<string, number> ?? {};
        const statusIdx = prop.statusId ?? prop.status ?? prop.itemStatus ?? -1;
        for (const id of itemIds) {
          const f = itemJObj[id];
          if (!f) continue;
          const rawStatus   = statusIdx >= 0 && f[statusIdx] !== undefined ? String(f[statusIdx]) : '';
          const statusLabel = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
          statusCounts[statusLabel] = (statusCounts[statusLabel] ?? 0) + 1;
        }
      }

      if (!raw?.next || itemIds.length < RANGE) break;
      index += RANGE;
    }

    return { count: total, statusCounts, backlogId };
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return null;
  }
}

// Fetch the kanban board ID (type=[7] sprint) for a kanban project
async function fetchKanbanBoardId(teamId: string, projectZohoId: string): Promise<string | null> {
  const token = getAccessToken();
  try {
    await zohoThrottle.wait(`kanban-id/${projectZohoId}`);
    const res = await axios.get(
      `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` }, params: { action: 'data', index: 1, range: 50, type: '[7]' } }
    );
    zohoThrottle.record(res.status);
    const ids: string[] = res.data?.sprintIds ?? [];
    return ids[0] ?? null;
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return null;
  }
}

// ── Epic fetching ─────────────────────────────────────────────────────────────

/**
 * Phase 3a: Sync epics from Zoho and persist to Epic table
 * Called during main sync for each project
 */
async function syncEpics(teamId: string, projectZohoId: string): Promise<number> {
  const token = getAccessToken();
  const base  = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}`;

  try {
    await zohoThrottle.wait(`epics/${projectZohoId}`);
    const epicRes = await axios.get(`${base}/epic/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index: 1, range: 100 },
    });
    zohoThrottle.record(epicRes.status);

    const raw      = epicRes.data as Record<string, unknown>;
    const epicIds  = (raw.epicIds as string[] | undefined) ?? [];
    const epicJObj = raw.epicJObj as Record<string, unknown[]> | undefined;
    const epicProp = (raw.epic_prop as Record<string, number> | undefined) ?? {};
    const nameIdx  = epicProp.epicName ?? epicProp.name ?? 1;

    let upsertedCount = 0;
    if (epicJObj) {
      for (const id of epicIds) {
        const f = epicJObj[id];
        if (!f) continue;
        const name = String(f[nameIdx] ?? 'Unnamed Epic').trim();

        await prisma.epic.upsert({
          where: { zohoId_projectZohoId: { zohoId: id, projectZohoId } },
          update: { name, syncedAt: new Date() },
          create: {
            zohoId: id,
            projectZohoId,
            name,
          },
        });
        upsertedCount++;
      }
    }

    return upsertedCount;
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return 0;
  }
}

/**
 * Phase 3b: Sync issues from Zoho and persist to Issue table
 * Called during main sync for each sprint within a project
 * 
 * Behavior:
 * - For closed sprints: delete all stored issues (to avoid stale data)
 * - For active sprints: upsert issues (merge with any manually created ones)
 */
async function syncIssues(
  teamId: string,
  projectZohoId: string,
  sprintZohoId: string,
  sprintStatus: string
): Promise<number> {
  const token = getAccessToken();
  const url   = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/${sprintZohoId}/item/`;

  // Get the project's statusMap from DB (populated by syncStatusMapFromZoho earlier)
  const project = await prisma.project.findUnique({ where: { zohoId: projectZohoId } });
  if (!project?.statusMap) {
    console.log(`  ⚠️  No statusMap for project ${projectZohoId}, skipping issues`);
    return 0;
  }

  let statusNameMap: Record<string, string>;   // statusId → human-readable status name
  let statusGroupMap: Record<string, string>;  // status name → 'todo' | 'doing' | 'done'
  try {
    const parsed = JSON.parse(project.statusMap) as {
      map: Record<string, string>;
      statusGroups: Record<string, string>;
    };
    statusNameMap  = parsed.map ?? {};
    statusGroupMap = parsed.statusGroups ?? {};
  } catch {
    console.log(`  ⚠️  Could not parse statusMap for project ${projectZohoId}`);
    return 0;
  }

  let totalIssues = 0;
  let index = 1;
  const RANGE = 100;

  while (true) {
    try {
      await zohoThrottle.wait(`issues/${sprintZohoId}/p${index}`);
      const res = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { action: 'data', index, range: RANGE },
      });
      zohoThrottle.record(res.status);

      const raw = res.data as Record<string, unknown>;
      const itemIds = (raw.itemIds as string[] | undefined) ?? [];
      const itemJObj = raw.itemJObj as Record<string, unknown[]> | undefined;

      if (!itemJObj || itemIds.length === 0) {
        break;
      }

      const itemProp = (raw.item_prop as Record<string, number> | undefined) ?? {};

      const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
      // Zoho exposes the human-readable ticket ID as 'itemNo' (not 'itemId' — that
      // name does not exist in item_prop). Default to 1 since itemNo is at index 1
      // in the items array (itemName=0, itemNo=1, createdBy=2, …).
      const itemNoIdx = itemProp.itemNo ?? 1;
      const titleIdx = itemProp.itemName ?? itemProp.name ?? 0;
      const epicIdIdx = itemProp.epicId ?? -1;
      // Zoho uses 'createdBy' for the ticket raiser (single zohoId string)
      const creatorIdx = itemProp.createdBy ?? itemProp.creatorId ?? itemProp.creator ?? itemProp.log_by ?? -1;
      // Zoho uses 'ownerId' (singular) for assignees — value can be a string, array, or comma-separated string
      const assigneeIdx = itemProp.ownerId ?? itemProp.owners ?? itemProp.assigneeId ?? itemProp.assignee ?? itemProp.owner ?? -1;
      const createdIdx = itemProp.createdTime ?? itemProp.createdOn ?? -1;
      const targetDateIdx = itemProp.endDate ?? itemProp.targetDate ?? -1;

      for (const itemId of itemIds) {
        const f = itemJObj[itemId];
        if (!f || !Array.isArray(f)) continue;

        const statusId = String(f[statusIdx] ?? '').trim();
        const statusName  = statusNameMap[statusId] ?? statusId;
        const statusGroup = (statusGroupMap[statusName] as 'todo' | 'doing' | 'done') ?? 'todo';

        const itemNo = String(f[itemNoIdx] ?? '').trim();
        const title = String(f[titleIdx] ?? 'Untitled').trim();
        const epicZohoId = epicIdIdx >= 0 ? String(f[epicIdIdx] ?? '').trim() || undefined : undefined;
        const creatorZohoId = creatorIdx >= 0 ? String(f[creatorIdx] ?? '').trim() || undefined : undefined;

        // Assignees: Zoho's ownerId can be:
        //   - a single user-id string ("22612000000013073")
        //   - a comma-separated string ("22612000000013073,22612000001520087")
        //   - an array of user-ids (["22612000000013073","22612000001520087"])
        //   - an empty array [] (no assignees)
        // Filter out sentinel/invalid values like '-1', '', and 0.
        let assigneeIds: string[] = [];
        if (assigneeIdx >= 0) {
          const assigneeVal = f[assigneeIdx];
          if (Array.isArray(assigneeVal)) {
            assigneeIds = assigneeVal
              .map(a => String(a).trim())
              .filter(a => a && a !== '-1');
          } else if (typeof assigneeVal === 'string') {
            const trimmed = assigneeVal.trim();
            if (trimmed && trimmed !== '-1') {
              // Handle comma-separated string OR single value
              assigneeIds = trimmed
                .split(',')
                .map(s => s.trim())
                .filter(s => s && s !== '-1');
            }
          }
        }

        const createdAt = createdIdx >= 0 ? String(f[createdIdx] ?? '').trim() || undefined : undefined;
        const endDate = targetDateIdx >= 0 ? String(f[targetDateIdx] ?? '').trim() || undefined : undefined;

        await prisma.issue.upsert({
          where: { zohoId_sprintZohoId: { zohoId: itemId, sprintZohoId } },
          update: {
            itemNo,
            title,
            status: statusName,
            statusGroup,
            epicZohoId,
            creatorZohoId,
            assigneeIds: JSON.stringify(assigneeIds),
            createdAt,
            endDate,
            syncedAt: new Date(),
          },
          create: {
            zohoId: itemId,
            sprintZohoId,
            projectZohoId,
            itemNo,
            title,
            status: statusName,
            statusGroup,
            epicZohoId,
            creatorZohoId,
            assigneeIds: JSON.stringify(assigneeIds),
            createdAt,
            endDate,
          },
        });

        totalIssues++;
      }

      // Check if there are more pages
      if (itemIds.length < RANGE) break;
      index += RANGE;
    } catch (err) {
      zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
      break;
    }
  }

  // For closed sprints, delete stored issues to avoid serving stale data
  if (sprintStatus === 'closed') {
    await prisma.issue.deleteMany({ where: { sprintZohoId } });
  }

  return totalIssues;
}

// ── Epic fetching ─────────────────────────────────────────────────────────────

export interface EpicBreakdown {
  id:              string;
  name:            string;
  total:           number;
  staleCount:      number;
  statusBreakdown: Record<string, number>;
  statusGroups:    Record<string, 'todo' | 'doing' | 'done'>;
  users:           { id: string; name: string; role: string }[];
}

// ── Issue list fetching ───────────────────────────────────────────────────────

export interface IssueItem {
  zohoId:      string;
  itemNo:      string;
  title:       string;
  status:      string;
  statusGroup: string;
  epicId:      string | null;
  creator:     { id: string; name: string; role: string } | null;
  assignees:   { id: string; name: string; role: string }[];
  createdAt:   string | null;
  endDate:     string | null;
  delayedDays: number;
  isStale:     boolean;
}

/** Clears all Zoho API caches. Called at the start of each sync to ensure fresh data. */
export function clearZohoCache(): void {
  statusMapCache.clear();
}

export async function syncAll(): Promise<number> {
  clearZohoCache();
  zohoThrottle.resetStats();
  const teamId = await resolveTeamId();

  const allProjects = await prisma.project.findMany({
    where: { boardType: { in: ['scrum', 'kanban'] }, hidden: false },
    orderBy: { name: 'asc' },
  });

  const scrumProjects  = allProjects.filter((p) => p.boardType === 'scrum');
  const kanbanProjects = allProjects.filter((p) => p.boardType === 'kanban');

  console.log(`\n🏃 Syncing ${scrumProjects.length} scrum + ${kanbanProjects.length} kanban projects`);

  let synced = 0;

  // ── Scrum projects ──────────────────────────────────────────────────────────
  for (const project of scrumProjects) {
    try {
      console.log(`▶ [scrum] ${project.name}`);
      
      // Phase 3a: Sync epics
      await syncEpics(teamId, project.zohoId);
      
      // Phase 3b: Sync status map (populates Project.statusMap in DB)
      const { map: statusMap, orderedNames, statusGroups } = await fetchStatusMapFromZoho(teamId, project.zohoId);

      // Backlog count (using status map for breakdown, but we only store count for scrum)
      const backlogResult = await fetchBacklogItems(teamId, project.zohoId, statusMap);
      if (backlogResult !== null) {
        await prisma.project.update({
          where: { zohoId: project.zohoId },
          data: { backlogCount: backlogResult.count },
        });
      }

      const sprints = await fetchSprintsForProject(teamId, project.zohoId);
      if (sprints.length === 0) continue;

      for (const sprint of sprints) {
        const rawCounts = await fetchItemsForSprint(teamId, project.zohoId, sprint.zohoId, statusMap);

        const statusBreakdown: Record<string, number> = {};
        for (const name of orderedNames) {
          statusBreakdown[name] = rawCounts[name] ?? 0;
        }
        for (const [name, count] of Object.entries(rawCounts)) {
          if (!(name in statusBreakdown)) statusBreakdown[name] = count;
        }

        const totalTickets = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

        await prisma.sprint.upsert({
          where:  { zohoId_projectZohoId: { zohoId: sprint.zohoId, projectZohoId: project.zohoId } },
          update: {
            name: sprint.name, status: sprint.status,
            startDate: sprint.startDate, endDate: sprint.endDate,
            totalTickets,
            statusBreakdown: JSON.stringify(statusBreakdown),
            rawData: JSON.stringify({ sprint, statusBreakdown, statusGroups }),
          },
          create: {
            zohoId: sprint.zohoId, projectZohoId: project.zohoId,
            projectName: project.name,
            name: sprint.name, status: sprint.status,
            startDate: sprint.startDate, endDate: sprint.endDate,
            totalTickets,
            statusBreakdown: JSON.stringify(statusBreakdown),
            rawData: JSON.stringify({ sprint, statusBreakdown, statusGroups }),
          },
        });

        // Phase 3c: Sync issues for this sprint
        await syncIssues(teamId, project.zohoId, sprint.zohoId, sprint.status);

        // Record daily burndown snapshot (upserts — safe to call on every sync)
        const doneCount = Object.entries(statusBreakdown)
          .filter(([name]) => statusGroups[name] === 'done')
          .reduce((sum, [, n]) => sum + n, 0);
        await recordBurndownSnapshot(sprint.zohoId, doneCount, totalTickets);

        synced++;
      }
    } catch (err) {
      console.error(`  ❌ Failed for ${project.name}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Kanban projects ─────────────────────────────────────────────────────────
  for (const project of kanbanProjects) {
    try {
      console.log(`▶ [kanban] ${project.name}`);
      
      // Phase 3a: Sync epics
      await syncEpics(teamId, project.zohoId);
      
      // Phase 3b: Sync status map
      const { map: statusMap, orderedNames, statusGroups } = await fetchStatusMapFromZoho(teamId, project.zohoId);

      // Backlog = items NOT yet on the board (use backlogId via action=getbacklog)
      const backlogResult = await fetchBacklogItems(teamId, project.zohoId, statusMap);
      const backlogCount = backlogResult?.count ?? 0;

      // Board items = items on the kanban board (use kanbanBoardId from type=[7] sprint)
      const kanbanBoardId = await fetchKanbanBoardId(teamId, project.zohoId);
      const boardStatusCounts: Record<string, number> = {};
      let boardTotal = 0;

      if (kanbanBoardId) {
        const rawCounts = await fetchItemsForSprint(teamId, project.zohoId, kanbanBoardId, statusMap);
        for (const [name, count] of Object.entries(rawCounts)) {
          boardStatusCounts[name] = count;
          boardTotal += count;
        }
        await syncIssues(teamId, project.zohoId, kanbanBoardId, 'active');
      }

      // Build full ordered breakdown (all statuses, zero-filled)
      const statusBreakdown: Record<string, number> = {};
      for (const name of orderedNames) {
        statusBreakdown[name] = boardStatusCounts[name] ?? 0;
      }
      for (const [name, count] of Object.entries(boardStatusCounts)) {
        if (!(name in statusBreakdown)) statusBreakdown[name] = count;
      }

      await prisma.project.update({
        where: { zohoId: project.zohoId },
        data: {
          backlogCount,
          statusBreakdown: JSON.stringify(statusBreakdown),
          statusGroups:    JSON.stringify(statusGroups),
        },
      });

      synced++;
    } catch (err) {
      console.error(`  ❌ Failed for ${project.name}:`, err instanceof Error ? err.message : err);
    }
  }

  zohoThrottle.printSummary();
  return synced;
}

// Keep old export for backwards compatibility
export const syncSprintHealth = syncAll;
