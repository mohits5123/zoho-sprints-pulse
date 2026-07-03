/**
 * Zoho Sprints synchronization and data fetching module.
 * 
 * This is the core synchronization engine for Zonaliser, responsible for:
 * - Fetching all project data from Zoho Sprints API (projects, epics, sprints, issues)
 * - Persisting data to local SQLite database via idempotent upserts
 * - Providing runtime caching for zero-latency API responses after initial sync
 * 
 * **Key Architecture Principles**:
 * - Local-first design: Runtime pages read from SQLite, never directly call Zoho
 *   This eliminates per-request rate limit concerns and enables instant page loads.
 * - Three-tier caching: Zoho → in-memory cache → SQLite DB. After first sync,
 *   all data is served locally (no Zoho calls during normal operation).
 * - Idempotent syncs: Safe to run multiple times; unchanged records are not overwritten.
 * 
 * **Rate Limiting**: All 260+ Zoho API calls across all projects are throttled via
 * zohoThrottle with per-label 25 req/60s sliding windows. Critical: bypassing throttle
 * will lock the entire team's Zoho API access (HTTP 400). See src/services/rateLimiter.ts.
 * 
 * **Sync Flow** (runs every 1 hour via cron or manual trigger):
 * 1. Clear in-memory caches → reset rate limiter stats
 * 2. Resolve Zoho team ID from settings
 * 3. Fetch all visible scrum/kanban projects
 * 4. For each project:
 *    - Phase 3a: Sync epics (upsert to Epic table)
 *    - Phase 3b: Fetch status map, persist to Project.statusMap JSON field + cache
 *    - Scrum workflow: fetch backlog → loop through sprints (sync issues per sprint)
 *    - Kanban workflow: fetch backlog → find board sprint → sync board issues
 * 5. Record daily burndown snapshots for each sprint
 * 
 * **Scrum vs Kanban**:
 * - Scrum: Traditional time-boxed sprints with dates, processes through status stages
 *   Issues are scoped to specific sprints and deleted when sprint closes.
 * - Kanban: Continuous flow with no timeboxes. Uses special "board" sprint (type=7)
 *   Issues are persisted globally to avoid data loss. Board items move through columns.
 * 
 * **Issue Lifecycle**:
 * - Active sprints: Issues upserted (merges with existing records, preserving manual edits)
 * - Closed sprints: All issues DELETED (avoids serving stale data to users)
 * 
 * **Zoho Data Transformations**:
 * - Status IDs (opaque numeric strings) → Human-readable names + work stage classification
 *   (todo/doing/done for burndown calculations)
 * - Zoho's dynamic JSON property arrays parsed into typed objects
 * - AssigneeIds normalized to JSON string array (Zoho supports single, comma-separated, or array formats)
 * - Dates normalized: '-1' → null (Zoho's "no date set" sentinel)
 * 
 * **Error Handling**: Failures on individual projects don't cascade. Each project
 * is wrapped in try-catch; sync continues with partial data. Rate limit errors stop
 * pagination for that specific call to avoid wasting rate limit buckets.
 */

import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { recordBurndownSnapshot } from './burndownSnapshots';
import { zohoThrottle } from './rateLimiter';
import { startSync, completeSync, touchLastSyncedAt } from './syncStatus';


const SETTINGS_KEY_TEAM_ID = 'zoho_team_id';

// ── In-memory caches ──────────────────────────────────────────────────────────

/**
 * Status map caching strategy:
 * - Caches are keyed by "${teamId}:${projectZohoId}" tuple
 * - Maps store statusId → name, orderedNames list, and statusGroups (todo/doing/done)
 * - Cleared at sync start via clearZohoCache() to ensure fresh data on each run
 * - After first sync, all lookups hit DB or cache — no Zoho calls needed
 */

interface StatusMapResult {
  map:          Record<string, string>;              // statusId → human-readable name
  orderedNames: string[];                           // Statuses in Zoho's display order
  statusGroups: Record<string, 'todo' | 'doing' | 'done'>;  // name → work stage
}

const statusMapCache = new Map<string, StatusMapResult>();

/**
 * Resolves the Zoho team ID from stored settings.
 * 
 * Returns cached team ID if available, otherwise throws error requiring
 * user sync to be run first.
 */
export async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;
  throw new Error('Team ID not found. Run user sync first.');
}

// ── Sprint Data Structures ───────────────────────────────────────────────────

/**
 * Raw sprint data structure returned by Zoho API.
 * 
 * This interface represents the minimal active sprint data fetched from Zoho's
 * /sprints/ endpoint with type=[2] filter. All other sprint statuses (past, future)
 * are excluded at the API level to minimize data transfer.
 * 
 * The raw structure is parsed and normalized during fetchSprintsForProject, converting
 * Zoho's dynamic JSON array format into strongly-typed objects suitable for database storage.
 */
interface SprintRaw {
  zohoId: string;    // Unique Zoho sprint ID
  name: string;      // Sprint display name (e.g., "Sprint 14")
  status: string;    // Always 'active' for this endpoint (type filter)
  statusCode: number; // Always 2 (Zoho's code for active sprint)
  startDate: string | null;   // Sprint start date, or '-1' represented as null
  endDate: string | null;     // Sprint end date, or '-1' represented as null
}

/**
 * Fetches active sprints for a specific project from Zoho.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/sprints/ with type=[2]
 * 
 * **Filtering**: Only returns sprints with type=2 (active/running). Past and future
 * sprints are filtered out at the API level to minimize data transfer.
 * 
 * **Rate Limiting**: Uses dedicated throttle label 'sprints/{projectZohoId}' to
 * prevent multiple projects from competing for the same rate limit bucket.
 * 
 * **Return**: Array of sprint objects with normalized fields (dates as ISO strings or null).
 * 
 * **Edge Cases**:
 * - If project has no sprints, returns empty array (valid state)
 * - Handles pagination via range parameter (max 50 sprints per call, but typically fewer)
 */
async function fetchSprintsForProject(teamId: string, projectZohoId: string): Promise<SprintRaw[]> {
  const token = getAccessToken();
  const url   = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/`;

  // Only fetch active/running sprints (type=[2])
  let res;
  try {
    await zohoThrottle.wait(`sprints/${projectZohoId}`);  // Rate limit with project-specific label
    res = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', type: '[2]', index: 1, range: 50 },
    });
    zohoThrottle.record(res.status);
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return [];  // Continue sync with other projects even if this one fails
  }

  const raw = res.data as Record<string, unknown>;
  const sprintIds: string[] = (raw?.sprintIds as string[] | undefined) ?? [];
  if (sprintIds.length === 0) return [];
  const sprintJObj = raw!.sprintJObj as Record<string, unknown[]>;
  const prop       = (raw!.sprint_prop as Record<string, number>) ?? {};

  // Determine column indices from Zoho's dynamic property layout
  const nameIdx       = prop.sprintName ?? 0;
  const startIdx      = prop.startDate  ?? 1;
  const endIdx        = prop.endDate    ?? 2;

  const allSprints: SprintRaw[] = [];
  for (const id of sprintIds) {
    const f = sprintJObj?.[id];
    if (!f) continue;  
    // Parse dates: '-1' means no date set in Zoho
    allSprints.push({
      zohoId:     id,
      name:       String(f[nameIdx] ?? 'Sprint').trim(),
      status:     'active',  // type=2 always means active in Zoho context
      statusCode: 2,
      startDate:  String(f[startIdx] ?? '-1') === '-1' ? null : String(f[startIdx]),
      endDate:    String(f[endIdx]   ?? '-1') === '-1' ? null : String(f[endIdx]),
    });
  }
  return allSprints;
}

/**
 * Fetches metadata for all completed (past) sprints for a project.
 * Only fetches sprint names, dates, and IDs — no issues or burndown data.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/sprints/ with type=[3]
 * 
 * **Rate Limiting**: Uses dedicated throttle label 'pastSprints/{projectZohoId}'
 * 
 * **Return**: Array of sprint metadata objects (zohoId, name, dates, status).
 */
export async function fetchPastSprintNames(teamId: string, projectZohoId: string): Promise<SprintRaw[]> {
  const token = getAccessToken();
  const url = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/`;

  let res;
  try {
    await zohoThrottle.wait(`pastSprints/${projectZohoId}`);
    res = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', type: '[3]', index: 1, range: 50 },
    });
    zohoThrottle.record(res.status);
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return [];
  }

  const raw = res.data as Record<string, unknown>;
  const sprintIds: string[] = (raw?.sprintIds as string[] | undefined) ?? [];
  if (sprintIds.length === 0) return [];
  const prop = (raw!.sprint_prop as Record<string, number>) ?? {};

  const nameIdx = prop.sprintName ?? 0;
  const startIdx = prop.startDate ?? 1;
  const endIdx = prop.endDate ?? 2;

  const allSprints: SprintRaw[] = [];
  const sprintJObjData = raw!.sprintJObj as Record<string, unknown[]>;
  for (const id of sprintIds) {
    const f = sprintJObjData?.[id];
    if (!f) continue;
    allSprints.push({
      zohoId:     id,
      name:       String(f[nameIdx] ?? 'Sprint').trim(),
      status:     'completed',
      statusCode: 3,
      startDate:  String(f[startIdx] ?? '-1') === '-1' ? null : String(f[startIdx]),
      endDate:    String(f[endIdx] ?? '-1') === '-1' ? null : String(f[endIdx]),
    });
  }

  return allSprints;
}

/**
 * Fetches full data for a single past sprint and upserts it into the database.
 * 
 * This function:
 * - Fetches sprint issue counts by status from Zoho
 * - Upserts the sprint record into the Sprint table
 * - Fetches and upserts all issues (NOT deleted like regular sync)
 * - Records a burndown snapshot
 * 
 * **Rate Limiting**: Uses dedicated throttle labels for issues and burndown.
 * 
 * @param sprintMeta - Sprint metadata (zohoId, name, dates) from fetchPastSprintNames
 * @param project - The project record (needed for statusMap and name)
 * @returns The upserted sprint record from the database
 */
export async function fetchPastSprintData(teamId: string, projectZohoId: string, sprintMeta: SprintRaw): Promise<any> {
  const project = await prisma.project.findUnique({ where: { zohoId: projectZohoId } });
  if (!project?.statusMap) {
    throw new Error(`No statusMap for project ${projectZohoId}`);
  }

  let statusNameMap: Record<string, string>;
  let statusGroupMap: Record<string, string>;
  try {
    const parsed = JSON.parse(project.statusMap) as {
      map: Record<string, string>;
      statusGroups: Record<string, string>;
    };
    statusNameMap = parsed.map ?? {};
    statusGroupMap = parsed.statusGroups ?? {};
  } catch {
    throw new Error(`Could not parse statusMap for project ${projectZohoId}`);
  }

  const { orderedNames, statusGroups } = await fetchStatusMap(teamId, projectZohoId);

  const rawCounts = await fetchItemsForSprint(teamId, projectZohoId, sprintMeta.zohoId, statusNameMap);

  const statusBreakdown: Record<string, number> = {};
  for (const name of orderedNames) {
    statusBreakdown[name] = rawCounts[name] ?? 0;
  }
  for (const [name, count] of Object.entries(rawCounts)) {
    if (!(name in statusBreakdown)) statusBreakdown[name] = count;
  }

  const totalTickets = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

  const sprint = await prisma.sprint.upsert({
    where:  { zohoId: sprintMeta.zohoId },
    update: {
      projectZohoId: project.zohoId,
      name: sprintMeta.name, status: sprintMeta.status,
      startDate: sprintMeta.startDate, endDate: sprintMeta.endDate,
      totalTickets,
      statusBreakdown: JSON.stringify(statusBreakdown),
      rawData: JSON.stringify({ sprint: sprintMeta, statusBreakdown, statusGroups }),
      projectName: project.name,
    },
    create: {
      zohoId: sprintMeta.zohoId, projectZohoId: project.zohoId,
      projectName: project.name,
      name: sprintMeta.name, status: sprintMeta.status,
      startDate: sprintMeta.startDate, endDate: sprintMeta.endDate,
      totalTickets,
      statusBreakdown: JSON.stringify(statusBreakdown),
      rawData: JSON.stringify({ sprint: sprintMeta, statusBreakdown, statusGroups }),
    },
  });

  // Sync issues for past sprint (upsert, NOT delete like regular sync)
  const token = getAccessToken();
  const issueUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/${sprintMeta.zohoId}/item/`;
  let index = 1;
  const RANGE = 100;

  while (true) {
    try {
      await zohoThrottle.wait(`pastIssues/${sprintMeta.zohoId}/p${index}`);
      const issueRes = await axios.get(issueUrl, {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
        params: { action: 'data', index, range: RANGE },
      });
      zohoThrottle.record(issueRes.status);

      const issueRaw = issueRes.data as Record<string, unknown>;
      const itemIds = (issueRaw.itemIds as string[] | undefined) ?? [];
      const itemJObj = issueRaw.itemJObj as Record<string, unknown[]> | undefined;

      if (!itemJObj || itemIds.length === 0) break;

      const itemProp = (issueRaw.item_prop as Record<string, number> | undefined) ?? {};
      const statusIdx = itemProp.statusId ?? itemProp.status ?? itemProp.itemStatus ?? -1;
      const itemNoIdx = itemProp.itemNo ?? 1;
      const titleIdx = itemProp.itemName ?? itemProp.name ?? 0;
      const epicIdIdx = itemProp.epicId ?? -1;
      const creatorIdx = itemProp.createdBy ?? itemProp.creatorId ?? itemProp.creator ?? itemProp.log_by ?? -1;
      const assigneeIdx = itemProp.ownerId ?? itemProp.owners ?? itemProp.assigneeId ?? itemProp.assignee ?? itemProp.owner ?? -1;
      const createdIdx = itemProp.createdTime ?? itemProp.createdOn ?? -1;
      const targetDateIdx = itemProp.endDate ?? itemProp.targetDate ?? -1;

      for (const itemId of itemIds) {
        const f = itemJObj[itemId];
        if (!f || !Array.isArray(f)) continue;

        const statusId = String(f[statusIdx] ?? '').trim();
        const statusName = statusNameMap[statusId] ?? statusId;
        const statusGroup = (statusGroupMap[statusName] as 'todo' | 'doing' | 'done') ?? 'todo';

        const itemNo = String(f[itemNoIdx] ?? '').trim();
        const title = String(f[titleIdx] ?? 'Untitled').trim();
        const epicZohoId = epicIdIdx >= 0 ? String(f[epicIdIdx] ?? '').trim() || undefined : undefined;
        const creatorZohoId = creatorIdx >= 0 ? String(f[creatorIdx] ?? '').trim() || undefined : undefined;

        let assigneeIds: string[] = [];
        if (assigneeIdx >= 0) {
          const assigneeVal = f[assigneeIdx];
          if (Array.isArray(assigneeVal)) {
            assigneeIds = assigneeVal.map(a => String(a).trim()).filter(a => a && a !== '-1');
          } else if (typeof assigneeVal === 'string') {
            const trimmed = assigneeVal.trim();
            if (trimmed && trimmed !== '-1') {
              assigneeIds = trimmed.split(',').map(s => s.trim()).filter(s => s && s !== '-1');
            }
          }
        }

        const createdAt = createdIdx >= 0 ? String(f[createdIdx] ?? '').trim() || undefined : undefined;
        const endDate = targetDateIdx >= 0 ? String(f[targetDateIdx] ?? '').trim() || undefined : undefined;

        await prisma.issue.upsert({
          where: { zohoId: itemId },
          update: {
            sprintZohoId: sprintMeta.zohoId,
            projectZohoId,
            itemNo, title, status: statusName, statusGroup,
            epicZohoId, creatorZohoId,
            assigneeIds: JSON.stringify(assigneeIds),
            createdAt, endDate, syncedAt: new Date(),
          },
          create: {
            zohoId: itemId, sprintZohoId: sprintMeta.zohoId, projectZohoId,
            itemNo, title, status: statusName, statusGroup,
            epicZohoId, creatorZohoId,
            assigneeIds: JSON.stringify(assigneeIds),
            createdAt, endDate,
          },
        });
      }

      if (itemIds.length < RANGE) break;
      index += RANGE;
    } catch (err) {
      zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
      break;
    }
  }

  // Record burndown snapshot
  const doneCount = Object.entries(statusBreakdown)
    .filter(([name]) => (statusGroups[name] as string) === 'done' || statusGroups[name] === 'done')
    .reduce((sum, [, n]) => sum + n, 0);
  await recordBurndownSnapshot(sprintMeta.zohoId, doneCount, totalTickets);

  return sprint;
}

// ── Ticket / item fetching ────────────────────────────────────────────────────

/**
 * Parses raw Zoho /itemstatus/ response into a StatusMapResult.
 * 
 * The Zoho itemstatus endpoint returns an opaque JSON structure with status mappings.
 * This function extracts the relevant fields and converts them into a normalized format
 * that can be used across all other functions in this module.
 * 
 * **Input**: Raw response from GET /team/{teamId}/projects/{projectZohoId}/itemstatus/
 * 
 * **Output**: StatusMapResult with:
 *   - map: statusId → human-readable name (for lookups)
 *   - orderedNames: statuses in Zoho's column order for kanban boards
 *   - statusGroups: name → work stage (todo/doing/done) for burndown calculations
 * 
 * **Status Type Mapping**: Zoho uses numeric codes that vary by project. This function
 * infers the group from the type code: 0=todo, 2=doing, 1=done. Falls back to 'todo'
 * for unknown codes.
 */
// ── Status Map Parsing ───────────────────────────────────────────────────────

/**
 * Parses raw Zoho /itemstatus/ response into a StatusMapResult.
 * 
 * The Zoho itemstatus endpoint returns an opaque JSON structure with status mappings
 * that varies in format across different projects. This function extracts the relevant
 * fields and converts them into a normalized, consistent format used throughout the app.
 * 
 * **Input**: Raw response from GET /team/{teamId}/projects/{projectZohoId}/itemstatus/
 * 
 * **Output**: StatusMapResult with:
 *   - map: statusId → human-readable name (for lookups by ID)
 *   - orderedNames: statuses in Zoho's column order (critical for kanban board rendering)
 *   - statusGroups: name → work stage (todo/doing/done) for burndown calculations
 * 
 * **Status Type Inference**: Zoho uses numeric type codes that vary by project:
 *   - 0 = Todo / Backlog / Not Started (blue cards, not shown in kanban)
 *   - 1 = Done / Closed / Complete (green cards, hidden in kanban)
 *   - 2 = In Progress / Doing (yellow card, the "active" work stage)
 *   - Unknown = defaults to 'todo' (safe fallback for unrecognized statuses)
 * 
 * **Caching**: Results are cached both in-memory (session-only) and persisted to DB,
 * enabling instant lookups without Zoho API calls after first sync.
 */

/**
 * Parses raw Zoho /itemstatus/ response into a StatusMapResult.
 * 
 * The Zoho itemstatus endpoint returns an opaque JSON structure with status mappings.
 * This function extracts the relevant fields and converts them into a normalized format
 * that can be used across all other functions in this module.
 * 
 * **Input**: Raw response from GET /team/{teamId}/projects/{projectZohoId}/itemstatus/
 * 
 * **Output**: StatusMapResult with:
 *   - map: statusId → human-readable name (for lookups)
 *   - orderedNames: statuses in Zoho's column order for kanban boards
 *   - statusGroups: name → work stage (todo/doing/done) for burndown calculations
 * 
 * **Status Type Mapping**: Zoho uses numeric codes that vary by project. This function
 * infers the group from the type code: 0=todo, 2=doing, 1=done. Falls back to 'todo'
 * for unknown codes.
 */
function parseStatusMapResponse(raw: Record<string, unknown>): StatusMapResult {  
  const statusJObj = raw?.statusJObj as Record<string, unknown[]> | undefined;
  const prop       = (raw?.status_prop as Record<string, number>) ?? {};
  const statusIds: string[] = (raw?.statusIds as string[] | undefined) ?? [];
  if (!statusJObj) return { map: {}, orderedNames: [], statusGroups: {} };

  const nameIdx = prop.statusName ?? 0;
  const typeIdx = prop.statusType ?? 4; // Zoho's generic index for status type
  const TYPE_MAP: Record<number, 'todo' | 'doing' | 'done'> = { 0: 'todo', 2: 'doing', 1: 'done' };

  const map: Record<string, string> = {};
  const statusGroups: Record<string, 'todo' | 'doing' | 'done'> = {};
  for (const [id, fields] of Object.entries(statusJObj)) {
    const name = String(fields[nameIdx] ?? 'Unknown').trim();
    // Safely extract type code, defaulting to 0 (todo) for unknown/malformed data
    const typeCode = typeof fields[typeIdx] === 'number' ? (fields[typeIdx] as number) : 0;
    map[id] = name;
    statusGroups[name] = TYPE_MAP[typeCode] ?? 'todo';  // Default to todo for unknown types
  }
  const orderedNames = statusIds.map(id => map[id]).filter((n): n is string => Boolean(n));
  return { map, orderedNames, statusGroups };
}

/**
 * Fetches the status map for a project from Zoho and persists it to both the database
 * and the in-memory cache.
 * 
 * Called ONLY by `syncAll` during the initial status map fetch phase. Never called
 * by runtime API handlers — those read from the in-memory cache or DB instead.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/itemstatus/
 * 
 * **Process**:
 * 1. Call Zoho's /itemstatus/ endpoint for the project
 * 2. Parse response using `parseStatusMapResponse()` to get normalized structure
 * 3. Store in DB: `Project.statusMap` field (JSON string) for persistence across restarts
 * 4. Cache in-memory: keyed by `"${teamId}:${projectZohoId}"` for fast lookups
 * 
 * **When it runs**: One call per project during `syncAll`, immediately after epics sync.
 * This is why status maps are "Phase 3b" in the overall sync flow.
 * 
 * **Post-Sync Behavior**: After first sync completes, all status map lookups hit
 * cache or DB — no additional Zoho calls are made. New projects fetched after sync
 * will trigger this function via `fetchStatusMap()`.
 * 
 * **Rate Limiting**: Uses dedicated throttle label `'statusMap/{projectZohoId}'`
 * to prevent multiple projects from competing for the same rate limit bucket.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @returns The parsed `StatusMapResult` containing status mappings and groupings
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
 * 
 * **Caching Strategy**: Three-tier lookup to minimize Zoho API calls:
 *   1. Check in-memory cache (statusMapCache) - fastest, session-only
 *   2. Query SQLite DB (Project.statusMap field) - persistent across restarts
 *   3. Fetch from Zoho only if both above are empty (first run for new project)
 * 
 * **Post-Sync Behavior**: After the first sync completes, this function never makes
 * Zoho API calls. All status map data is served from local storage (cache + DB).
 * 
 * **Thread Safety**: Not thread-safe. If multiple async callers invoke this concurrently,
 * the first one to reach Zoho will populate both cache and DB. Subsequent callers get cached data.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @returns The `StatusMapResult` containing status mappings and groupings
 */
async function fetchStatusMap(teamId: string, projectZohoId: string): Promise<StatusMapResult> {
  const cacheKey = `${teamId}:${projectZohoId}`;
  
  // Fast path: in-memory cache hit (most common case during runtime)
  const cached = statusMapCache.get(cacheKey);
  if (cached) return cached;

  // Second tier: Load from DB (populated during sync, persistent across restarts)
  const project = await prisma.project.findUnique({
    where:  { zohoId: projectZohoId },
    select: { statusMap: true },
  });
  
  if (project?.statusMap) {
    const result = JSON.parse(project.statusMap) as StatusMapResult;
    statusMapCache.set(cacheKey, result);  // Populate cache for faster subsequent lookups
    return result;
  }

  // Third tier (first run): Must fetch from Zoho
  return fetchStatusMapFromZoho(teamId, projectZohoId);
}

/**
 * Fetches issue counts grouped by status for a given sprint.
 * 
 * This function paginates through all items in a sprint and tallies them by their
 * current status. It is used to build the status breakdown (count per status label)
 * that powers sprint analytics and burndown calculations.
 * 
 * **Endpoint Flow**:
 * 1. GET /team/{teamId}/projects/{projectZohoId}/sprints/{sprintId}/item/
 *    → Returns paginated list of items with their status IDs
 * 2. Maps each status ID to a human-readable label via `statusMap`
 * 3. Returns a tally: `{ "In Progress": 5, "Closed": 12, ... }`
 * 
 * **Rate Limiting**: Uses dedicated throttle label `'items/{sprintId}/p{page}'`
 * to prevent multiple sprints from competing for the same rate limit bucket.
 * 
 * **Pagination**: Fetches in batches of 100 items. Stops when fewer than 100 items
 * are returned or when Zoho signals no more pages are available (`!raw.next`).
 * 
 * **Error Handling**: On any API error, stops pagination immediately to avoid
 * wasting rate limit buckets. Returns whatever counts have been accumulated so far.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @param sprintId - The Zoho sprint identifier (not the project sprint name)
 * @param statusMap - Map of Zoho status IDs to human-readable status names
 * @returns Record mapping each status label to its issue count (e.g., `{ "In Progress": 5, "Closed": 12 }`)
 */
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
      break;  // Stop pagination on error to avoid wasting rate limit buckets
    }

    const raw = res.data;
    
    // `itemIds: []` means sprint exists but has 0 tickets — valid empty response
    const itemIds: string[] = raw?.itemIds ?? [];
    const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;

    if (!itemJObj && Array.isArray(raw?.itemIds)) {
      break;  // No items returned, sprint is empty or pagination exhausted
    }

    if (itemJObj) {
      // Handle case where itemIds is a subset of actual items in JObj
      const resolvedIds: string[] = raw?.itemIds ?? Object.keys(itemJObj);

      // Get the index of status field from Zoho's dynamic property layout
      const prop      = raw?.item_prop as Record<string, number> ?? {};
      const statusIdx = prop.statusId ?? prop.status ?? prop.itemStatus ?? -1;

      for (const id of resolvedIds) {
        const f = itemJObj[id];
        if (!f) continue;

        // Get raw status value at the correct index (or empty string if index invalid)
        const rawStatus   = statusIdx >= 0 && f[statusIdx] !== undefined ? String(f[statusIdx]) : '';
        const statusLabel = statusMap[rawStatus] ?? rawStatus ?? 'Unknown';
        statusCounts[statusLabel] = (statusCounts[statusLabel] ?? 0) + 1;
      }

      if (!raw.next || resolvedIds.length < RANGE) break;  // No more pages or partial page
    } else {
      break;  // Unexpected response format, stop pagination
    }

    index += RANGE;
  }

  return statusCounts;
}

// ── Backlog fetching ─────────────────────────────────────────────────────────

/**
 * Represents the result of a backlog fetch operation.
 * 
 * Used for both Scrum (stores count only) and Kanban projects (stores count + status breakdown).
 * 
 * **Kanban Context**: Backlog represents items NOT yet on the kanban board. Items move from
 * backlog → board when assigned to a user and started. The status breakdown shows the distribution
 * of items waiting in the queue by status.
 */
interface BacklogResult {
  count: number;                    // Total items in backlog
  statusCounts: Record<string, number>;  // Status → count breakdown
  backlogId: string;                // Zoho's backlog ID (used as sprint-like entity)
}

/**
 * Fetches the project backlog and counts items by status.
 * 
 * **What is backlog?** Items that exist in the project but are NOT yet on any
 * sprint or kanban board. These typically include newly created tickets that haven't
 * been assigned to anyone yet, or items removed from a closed sprint.
 * 
 * **Endpoint Flow**:
 * 1. GET /team/{teamId}/projects/{projectZohoId} with action=getbacklog
 *    → Returns backlogId (the sprint-like ID representing the backlog)
 * 2. GET /team/{teamId}/projects/{projectZohoId}/sprints/{backlogId}/item/
 *    → Returns items in the backlog with pagination (range=100)
 * 
 * **Rate Limiting**: Uses dedicated throttle label 'backlog-items/{projectZohoId}/p{page}'
 * 
 * **Return**: 
 *   - For Scrum projects: Only the count is stored in Project.backlogCount
 *   - For Kanban projects: Full status breakdown is stored for kanban board comparison
 * 
 * **Error Handling**: Returns null if backlogId cannot be retrieved (project has no backlog).
 */
async function fetchBacklogItems(
  teamId: string,
  projectZohoId: string,
  statusMap: Record<string, string>
): Promise<BacklogResult | null> {
  const token = getAccessToken();
  const baseUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/`;

  try {
    await zohoThrottle.wait(`backlog-id/${projectZohoId}`);
    
    // Step 1: Get backlog ID via special action parameter
    const backlogRes = await axios.get(baseUrl, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'getbacklog' },
    });
    zohoThrottle.record(backlogRes.status);
    
    const backlogId: string | undefined = backlogRes.data?.backlogId;
    if (!backlogId) {
      return null;  // Project has no backlog configured or it's empty
    }

    // Step 2: Fetch items from the backlog "sprint"
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
      
      total += itemIds.length;  // Track total items fetched across all pages

      const itemJObj = raw?.itemJObj as Record<string, unknown[]> | undefined;
      
      // Process items only if we have a JObj and there are itemIds to process
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

      if (!raw?.next || itemIds.length < RANGE) break;  // No more pages or partial page
      index += RANGE;
    }

    return { count: total, statusCounts, backlogId };
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return null;  // Continue sync with other projects
  }
}

/**
 * Fetches the kanban board sprint ID for a kanban-type project.
 * 
 * **Purpose**: Kanban projects in Zoho don't use traditional sprints. Instead, they have
 * a "board" represented as a sprint with type=[7]. This function finds that board.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/sprints/ with type=[7]
 * 
 * **Return**: 
 *   - The zohoId of the board sprint if found
 *   - null if no board exists (project has never had items assigned)
 * 
 * **Usage**: The returned ID is then used with fetchItemsForSprint to get board item counts.
 * 
 * **Rate Limiting**: Uses dedicated throttle label 'kanban-id/{projectZohoId}'.
 */
/**
 * Fetches the kanban board sprint ID for a kanban-type project.
 * 
 * **Purpose**: Kanban projects in Zoho don't use traditional time-boxed sprints.
 * Instead, they have a "board" represented as a sprint with type=[7]. This function
 * locates that board sprint so its issues can be fetched and synced.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/sprints/ with type=[7]
 * 
 * **Return**: 
 *   - The `zohoId` of the board sprint if found
 *   - `null` if no board exists (project has never had items assigned)
 * 
 * **Usage**: The returned ID is then used with `fetchItemsForSprint` to get board item counts
 * and with `syncIssues` to sync issues to the database.
 * 
 * **Rate Limiting**: Uses dedicated throttle label `'kanban-id/{projectZohoId}'`.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @returns The zohoId of the kanban board sprint, or null if no board exists
 */
async function fetchKanbanBoardId(teamId: string, projectZohoId: string): Promise<string | null> {
  const token = getAccessToken();
  
  try {
    await zohoThrottle.wait(`kanban-id/${projectZohoId}`);
    
    const res = await axios.get(
      `${config.zoho.apiBaseUrl}/team/${teamId}/projects/${projectZohoId}/sprints/`,
      { 
        headers: { Authorization: `Zoho-oauthtoken ${token}` }, 
        params: { action: 'data', index: 1, range: 50, type: '[7]' } 
      }
    );
    
    zohoThrottle.record(res.status);
    const ids: string[] = res.data?.sprintIds ?? [];
    
    return ids[0] ?? null;  // Return first (and typically only) board sprint
  } catch (err) {
    zohoThrottle.recordError(axios.isAxiosError(err) ? err.response?.status : undefined);
    return null;
  }
}

// ── Epic fetching ─────────────────────────────────────────────────────────────

/**
 * Phase 3a: Fetches all epics for a project from Zoho and upserts them to the local Epic table.
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/epic/ with action=data
 * 
 * **Process**:
 * 1. Fetch all epics from Zoho (paginated, max 100 per page)
 * 2. For each epic, upsert into the Epic table using the unique zohoId
 * 3. Returns the count of epics upserted
 * 
 * **Idempotency**: Uses Prisma upsert — if an epic already exists, only the name
 * and syncedAt timestamp are updated. The projectZohoId is also refreshed.
 * 
 * **Rate Limiting**: Uses dedicated throttle label `'epics/{projectZohoId}'`.
 * 
 * **Error Handling**: On any API error, logs the error and returns 0. The sync continues
 * with other projects — this failure does not cascade.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @returns The number of epics successfully upserted
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
          where: { zohoId: id },
          update: { projectZohoId, name, syncedAt: new Date() },
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
 * Phase 3b: Fetches all issues for a sprint from Zoho and persists them to the Issue table.
 * 
 * Called during the main sync for each sprint (or backlog) within a project.
 * 
 * **Behavior by sprint status**:
 * - **Active sprints**: Issues are upserted — new issues are inserted, existing ones are
 *   updated. This preserves any manually created issues that don't exist in Zoho.
 * - **Closed sprints**: After upserting current Zoho data, ALL stored issues for that
 *   sprint are DELETED. This ensures stale data from closed sprints is never served
 *   to users. (Note: `fetchPastSprintData` uses a different code path that upserts
 *   instead of deleting, for historical preservation.)
 * 
 * **Endpoint**: GET /team/{teamId}/projects/{projectZohoId}/sprints/{sprintZohoId}/item/
 * 
 * **Data Transformations**:
 * - Status IDs (opaque numeric strings) → human-readable names via the project's statusMap
 * - AssigneeIds normalized to JSON string array (handles single string, comma-separated, or array formats)
 * - Dates normalized: '-1' → null (Zoho's "no date set" sentinel)
 * - Epic creator and assignee IDs stored as Zoho user IDs for later enrichment
 * 
 * **Pagination**: Fetches in batches of 100 issues. Stops when fewer than 100 issues
 * are returned or when Zoho signals no more pages.
 * 
 * **Rate Limiting**: Uses dedicated throttle label `'issues/{sprintZohoId}/p{page}'`.
 * 
 * **Error Handling**: On any API error, stops pagination immediately to avoid wasting
 * rate limit buckets. Returns whatever counts have been accumulated so far.
 * 
 * @param teamId - The Zoho team identifier
 * @param projectZohoId - The Zoho project identifier
 * @param sprintZohoId - The Zoho sprint (or backlog) identifier
 * @param sprintStatus - The sprint's status: `'active'` for upsert, `'closed'` for delete
 * @returns The number of issues successfully synced (upserted) before any potential deletion
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
    console.log(`  No statusMap for project ${projectZohoId}, skipping issues`);
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
    console.log(`  Could not parse statusMap for project ${projectZohoId}`);
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
          where: { zohoId: itemId },
          update: {
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

/**
 * Epic breakdown structure for sprint cards.
 * Used by the /epics route to show issue distribution per epic in a sprint.
 * 
 * Each EpicBreakdown represents one epic (or "Unassigned") within a sprint,
 * aggregating all issues assigned to that epic.
 * 
 * @property {string} id - The Zoho ID of the epic (e.g., "EPIC-789") or "__unassigned__"
 * @property {string} name - Display name of the epic (or "Unassigned" for unepiced issues)
 * @property {number} total - Total count of issues in this epic
 * @property {number} staleCount - Number of stale issues (age > staleDays threshold, non-done)
 * @property {Record<string, number>} statusBreakdown - Status counts keyed by status name:
 *   - Ordered according to the project's `orderedNames` from statusMap
 *   - Includes all statuses, even those with 0 count (for consistent chart rendering)
 * @property {Record<string, 'todo' | 'doing' | 'done'>} statusGroups - Work bucket mapping:
 *   - Maps each status to its bucket ('todo', 'doing', or 'done')
 *   - Used for card color-coding in the UI (blue, yellow, green)
 * @property {UserInfo[]} users - Array of unique UserInfo objects for all involved users:
 *   - Includes assignees AND the ticket creator (if different from assignee)
 *   - Used to show user avatars on epic cards
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

// ── Issue list fetching ───────────────────────────────────────────────────────

/**
 * Issue item data structure with computed staleness metrics.
 * Used for displaying issues in sprint cards, epic breakdowns, and user profiles.
 * 
 * This interface extends the raw Zoho issue data with:
 * - Computed `isStale` flag based on creation date vs. staleDays threshold
 * - Computed `delayedDays` showing days past due (0 if not overdue)
 * - Enriched user objects for creator and assignees (from local DB mapping)
 * 
 * @property {string} zohoId - Unique Zoho issue ID (primary key in local DB)
 * @property {string} itemNo - Ticket number format matching Zoho (e.g., "PROJ-123", "BUG-456")
 * @property {string} title - Issue title/description summary from Zoho API
 * 
 * @property {string} status - Human-readable current status (e.g., "In Progress", "Closed")
 * @property {string} statusGroup - Work bucket categorization: 'todo' | 'doing' | 'done'
 *   - Used for color-coding cards and computing completion rates
 * 
 * @property {string | null} epicId - Parent Epic's Zoho ID if assigned to one, otherwise null
 * 
 * @property {UserInfo | null} creator - Object containing the ticket raiser's info:
 *   `{ id, name, role }`. May be null if no creator is recorded.
 * 
 * @property {UserInfo[]} assignees - Array of `{ id, name, role }` objects for all assigned users.
 *   May be empty if the issue is unassigned (or epic-unassigned).
 * 
 * @property {string | null} createdAt - ISO timestamp when the issue was created in Zoho, or null
 *   Used for computing staleness against staleDays threshold.
 * 
 * @property {string | null} endDate - Planned due date target from the sprint or manually set, or null
 *   Used for computing delayedDays when past due.
 * 
 * @property {number} delayedDays - Number of days overdue (negative if before the due date).
 *   Example: `-3` means 3 days remaining, `2` means 2 days overdue.
 * 
 * @property {boolean} isStale - True if the issue has exceeded the staleDays threshold without updates.
 *   Staleness is computed based on createdAt + watchedStates configuration.
 * 
 * @see ContextualIssue - Same structure but with sprint/project context for user profile routes
 */
export interface IssueItem {
  zohoId:      string;    // Unique Zoho issue ID (primary key in DB)
  itemNo:      string;    // Ticket number (e.g., "PROJ-123")
  title:       string;    // Issue title from Zoho
  
  status:      string;    // Human-readable status name
  statusGroup: string;    // Work stage: 'todo' | 'doing' | 'done'
  
  epicId:      string | null;   // Parent Epic's zohoId if assigned to one
  
  creator:     { id: string; name: string; role: string } | null;   // Ticket raiser
  assignees:   { id: string; name: string; role: string }[];        // Assigned users
  
  createdAt:   string | null;   // ISO timestamp or null
  endDate:     string | null;   // Due date target or null
  
  delayedDays: number;          // Days past due date (negative if not overdue)
  isStale:     boolean;          // True if no update in staleDays threshold
}

/**
 * Clears all in-memory caches used by this module.
 * 
 * Called at the start of each `syncAll()` run to ensure that status maps and any
 * other cached data are fresh for the new sync cycle. The in-memory cache is
 * repopulated as data is fetched from Zoho during the sync.
 * 
 * **What it clears**: Only the `statusMapCache` Map. The in-memory cache is
 * session-only (lost on process restart) and does not persist across restarts.
 * 
 * **When it runs**: At the beginning of every `syncAll()` execution, before any
 * Zoho API calls are made. This guarantees that stale cached data from a previous
 * sync run is not used during the current sync.
 * 
 * **Thread Safety**: Not thread-safe. Should only be called synchronously at the
 * start of `syncAll()`, before any concurrent access begins.
 */
export function clearZohoCache(): void {
  statusMapCache.clear();  // Status maps are re-fetched from DB on next sync call
}

/**
 * Full synchronization of all Zoho Projects data to the local SQLite database.
 * 
 * This is the main sync operation triggered by cron (every 1 hour) and manual user requests.
 * It fetches all projects, epics, sprints, backlog items, and issues from the Zoho Sprints API
 * and upserts them to the local database.
 * 
 * **Sync Flow**:
 * 1. Clear all in-memory caches (ensures fresh status maps)
 * 2. Reset rate limiter stats
 * 3. Resolve team ID from settings
 * 4. Fetch all visible scrum and kanban projects from the DB
 * 5. For each scrum project:
 *    - Sync epics (Phase 3a)
 *    - Fetch and persist status map (Phase 3b)
 *    - Fetch backlog count and sync backlog issues
 *    - For each active sprint: upsert sprint data, sync issues, record burndown snapshot
 *    - Mark stale sprints as completed or delete them
 *    - Refresh completed sprints one last time for final issue counts
 *    - Persist project-level status breakdown and groups
 * 6. For each kanban project:
 *    - Sync epics (Phase 3a)
 *    - Fetch and persist status map (Phase 3b)
 *    - Fetch backlog items and sync backlog issues
 *    - Find kanban board sprint (type=[7]) and sync board items
 *    - Store full status breakdown and groups in Project for analytics
 * 7. Print rate limiter summary on completion
 * 
 * **Rate Limiting**: Critical! All Zoho API calls are throttled via `zohoThrottle`.
 * This function coordinates throttle waits across multiple projects to avoid exceeding
 * the 25 req/min limit per label. See `src/services/rateLimiter.ts` for details.
 * 
 * **Idempotency**: Safe to run multiple times. Uses Prisma upserts with unique keys
 * (zohoId + projectZohoId for epics/issues, zohoId for sprints). Unchanged data is not
 * overwritten; only new/modified records are updated.
 * 
 * **Error Handling**: Failures on individual projects are caught and logged but do not
 * stop the sync. Other projects continue processing. Partial data is acceptable — the
 * next sync run will pick up where the last one left off.
 * 
 * **Cron Schedule**: Runs automatically every 1 hour at minute 0 (midnight, 1am, 2am, etc.)
 * 
 * @returns The total number of sprints successfully synced across all projects
 */
export async function syncAll(): Promise<number> {
  clearZohoCache();      // Ensure fresh status maps on this sync run
  zohoThrottle.resetStats();  // Reset rate limiter tracking
  
  const teamId = await resolveTeamId();

  const allProjects = await prisma.project.findMany({
    where: { boardType: { in: ['scrum', 'kanban'] }, hidden: false },
    orderBy: { name: 'asc' },
  });

  const scrumProjects  = allProjects.filter((p) => p.boardType === 'scrum');
  const kanbanProjects = allProjects.filter((p) => p.boardType === 'kanban');

  console.log(`\nSyncing ${scrumProjects.length} scrum + ${kanbanProjects.length} kanban projects`);

  let synced = 0;

  // ── Scrum projects ──────────────────────────────────────────────────────────
  
  /**
   * Sync loop for scrum projects.
   * 
   * For each scrum project:
   * 1. Sync epics from Zoho to Epic table
   * 2. Fetch status map and persist to Project.statusMap
   * 3. Fetch backlog count (stored in Project.backlogCount)
   * 4. For each sprint:
   *    - Fetch items by status (for analytics cards)
   *    - Upsert sprint data to Sprint table
   *    - Sync issues for this sprint (upsert if active, delete if closed)
   *    - Record burndown snapshot for the sprint
   */
  for (const project of scrumProjects) {
    try {
      console.log(`[scrum] ${project.name}`);
      
      // Phase 3a: Sync epics
      await syncEpics(teamId, project.zohoId);
      
      // Phase 3b: Sync status map (populates Project.statusMap in DB)
      const { map: statusMap, orderedNames, statusGroups } = await fetchStatusMapFromZoho(teamId, project.zohoId);

      // Backlog count and sync backlog issues
      const backlogResult = await fetchBacklogItems(teamId, project.zohoId, statusMap);
      if (backlogResult !== null) {
        await prisma.project.update({
          where: { zohoId: project.zohoId },
          data: { 
            backlogCount: backlogResult.count,
            backlogZohoId: backlogResult.backlogId 
          },
        });
        // Sync backlog issues to the Issue table using backlogId as sprintZohoId
        await syncIssues(teamId, project.zohoId, backlogResult.backlogId, 'active');
      }

      const sprints = await fetchSprintsForProject(teamId, project.zohoId);
      const activeSprintIds = new Set(sprints.map(s => s.zohoId));
      const staleSprints = await prisma.sprint.findMany({
        where: { projectZohoId: project.zohoId },
        select: { zohoId: true, status: true, endDate: true },
      });
      const now = new Date();
      for (const stale of staleSprints) {
        if (!activeSprintIds.has(stale.zohoId)) {
          if (stale.status === 'completed') {
            // Keep completed sprints — they're preserved for historical view
            continue;
          }
          // If sprint ended but Zoho no longer returns it as active, mark it completed
          if (stale.endDate && new Date(stale.endDate) < now && stale.status === 'active') {
            await prisma.sprint.update({
              where: { zohoId: stale.zohoId },
              data: { status: 'completed' },
            });
          } else if (stale.status === 'active') {
            // Sprint is active locally but gone from Zoho and hasn't ended yet
            // Mark it completed to preserve its issues rather than deleting
            await prisma.sprint.update({
              where: { zohoId: stale.zohoId },
              data: { status: 'completed' },
            });
          } else {
            // Truly stale sprint (e.g., future/planned) — delete it
            await prisma.sprint.delete({ where: { zohoId: stale.zohoId } });
          }
        }
      }
      if (sprints.length === 0) continue;

      let lastSprintBreakdown: Record<string, number> | null = null;

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
          where:  { zohoId: sprint.zohoId },
          update: {
            projectZohoId: project.zohoId,
            name: sprint.name, status: sprint.status,
            startDate: sprint.startDate, endDate: sprint.endDate,
            totalTickets,
            statusBreakdown: JSON.stringify(statusBreakdown),
            rawData: JSON.stringify({ sprint, statusBreakdown, statusGroups }),
            projectName: project.name,
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

        lastSprintBreakdown = statusBreakdown;
        synced++;
      }

      // Final sync: refresh completed sprints one last time to capture any
      // issues that may have been moved out before the sprint was closed
      const completedSprints = await prisma.sprint.findMany({
        where: { projectZohoId: project.zohoId, status: 'completed' },
        select: { zohoId: true },
      });
      for (const completed of completedSprints) {
        try {
          const rawCounts = await fetchItemsForSprint(teamId, project.zohoId, completed.zohoId, statusMap);
          const statusBreakdown: Record<string, number> = {};
          for (const name of orderedNames) {
            statusBreakdown[name] = rawCounts[name] ?? 0;
          }
          for (const [name, count] of Object.entries(rawCounts)) {
            if (!(name in statusBreakdown)) statusBreakdown[name] = count;
          }
          const totalTickets = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
          await prisma.sprint.update({
            where: { zohoId: completed.zohoId },
            data: {
              totalTickets,
              statusBreakdown: JSON.stringify(statusBreakdown),
            },
          });
          await syncIssues(teamId, project.zohoId, completed.zohoId, 'completed');
          const doneCount = Object.entries(statusBreakdown)
            .filter(([name]) => statusGroups[name] === 'done')
            .reduce((sum, [, n]) => sum + n, 0);
          await recordBurndownSnapshot(completed.zohoId, doneCount, totalTickets);
        } catch (err) {
          console.error(`  Failed to sync completed sprint ${completed.zohoId}:`, err instanceof Error ? err.message : err);
        }
      }

      // Persist project-level status breakdown and groups for analytics queries
      await prisma.project.update({
        where: { zohoId: project.zohoId },
        data: {
          statusBreakdown: lastSprintBreakdown ? JSON.stringify(lastSprintBreakdown) : null,
          statusGroups: JSON.stringify(statusGroups),
        },
      });
    } catch (err) {
      console.error(`  Failed for ${project.name}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Kanban projects ─────────────────────────────────────────────────────────

  /**
   * Sync loop for kanban projects.
   * 
   * For each kanban project:
   * 1. Sync epics from Zoho to Epic table
   * 2. Fetch and persist status map (same as scrum)
   * 3. Fetch backlog items (items NOT yet on the board, stored in Project)
   * 4. Find kanban board sprint (type=[7]) and fetch items on board
   * 5. Sync issues for the kanban board (upsert)
   * 6. Store full status breakdown and groups in Project for analytics queries
   */
  for (const project of kanbanProjects) {
    try {
      console.log(`[kanban] ${project.name}`);
      
      // Phase 3a: Sync epics from Zoho to local Epic table
      await syncEpics(teamId, project.zohoId);
      
      // Phase 3b: Fetch and persist status map (populates Project.statusMap in DB)
      const { map: statusMap, orderedNames, statusGroups } = await fetchStatusMapFromZoho(teamId, project.zohoId);

      // Fetch backlog items (items NOT yet on the board)
      // Kanban projects have a separate "backlog" of unassigned items
      const backlogResult = await fetchBacklogItems(teamId, project.zohoId, statusMap);
      const backlogCount = backlogResult?.count ?? 0;

      // Sync backlog issues to the Issue table using backlogId as sprintZohoId
      if (backlogResult !== null) {
        await syncIssues(teamId, project.zohoId, backlogResult.backlogId, 'active');
      }

      // Find kanban board sprint (type=[7] - special Zoho sprint type for boards)
      // If no board exists yet (first item hasn't been created/moved), returns null
      const kanbanBoardId = await fetchKanbanBoardId(teamId, project.zohoId);
      
      const boardStatusCounts: Record<string, number> = {};
      let boardTotal = 0;

      if (kanbanBoardId) {
        // Fetch items currently on the kanban board
        const rawCounts = await fetchItemsForSprint(teamId, project.zohoId, kanbanBoardId, statusMap);
        
        for (const [name, count] of Object.entries(rawCounts)) {
          boardStatusCounts[name] = count;
          boardTotal += count;
        }
        
        // Sync issues for the kanban board (treated as "active" sprint)
        await syncIssues(teamId, project.zohoId, kanbanBoardId, 'active');

        // Create/update Sprint record so queryKanbanBoardIssues can identify this board
        // The statusCode=7 marker is used by queryKanbanBoardIssues to filter kanban issues
        const totalTickets = Object.values(boardStatusCounts).reduce((a, b) => a + b, 0);
        await prisma.sprint.upsert({
          where:  { zohoId: kanbanBoardId },
          update: {
            projectZohoId: project.zohoId,
            name: `${project.name} Board`,
            status: 'active',
            startDate: null,
            endDate: null,
            totalTickets,
            statusBreakdown: JSON.stringify(boardStatusCounts),
            rawData: JSON.stringify({ sprint: { statusCode: 7 }, statusBreakdown: boardStatusCounts, statusGroups }),
            projectName: project.name,
          },
          create: {
            zohoId: kanbanBoardId,
            projectZohoId: project.zohoId,
            projectName: project.name,
            name: `${project.name} Board`,
            status: 'active',
            startDate: null,
            endDate: null,
            totalTickets,
            statusBreakdown: JSON.stringify(boardStatusCounts),
            rawData: JSON.stringify({ sprint: { statusCode: 7 }, statusBreakdown: boardStatusCounts, statusGroups }),
          },
        });
      } else {
        // No kanban board found — clean up any stale kanban sprint records
        // but preserve completed sprints
        const kanbanSprints = await prisma.sprint.findMany({
          where: {
            projectZohoId: project.zohoId,
            rawData: {
              contains: JSON.stringify({ sprint: { statusCode: 7 } }),
            },
          },
          select: { zohoId: true },
        });
        for (const kanbanSprint of kanbanSprints) {
          await prisma.sprint.delete({ where: { zohoId: kanbanSprint.zohoId } });
        }
      }

      // Build full ordered breakdown (all statuses, zero-filled for missing ones)
      const statusBreakdown: Record<string, number> = {};
      
      // Initialize with ordered statuses from map (for kanban column order)
      for (const name of orderedNames) {
        statusBreakdown[name] = boardStatusCounts[name] ?? 0;
      }
      
      // Add any additional statuses not in orderedNames (e.g., "closed")
      for (const [name, count] of Object.entries(boardStatusCounts)) {
        if (!(name in statusBreakdown)) statusBreakdown[name] = count;
      }

      // Persist project-level data for analytics queries
      await prisma.project.update({
        where: { zohoId: project.zohoId },
        data: {
          backlogCount,      // Total items in backlog
          backlogZohoId: backlogResult?.backlogId ?? null,  // Zoho backlog ID for identifying backlog issues
          statusBreakdown: JSON.stringify(statusBreakdown),  // By-status breakdown
          statusGroups:    JSON.stringify(statusGroups),     // Work stage mapping
        },
      });

      synced++;  // Count this project as successfully processed
    } catch (err) {
      console.error(`  Failed for ${project.name}:`, err instanceof Error ? err.message : err);
      // Continue with other projects even if this one fails
    }
  }

  zohoThrottle.printSummary();
  
  return synced;
}

// Keep old export for backwards compatibility
export const syncSprintHealth = syncAll;

/**
 * Full synchronization wrapper that tracks sync state for the UI progress bar.
 * 
 * This function wraps `syncAll()` with lifecycle hooks that manage the sync status
 * record in the database. It sets the sync as "in-progress" before starting, updates
 * the last-synced timestamp after completion, and records the total API requests sent
 * to Zoho (for rate limit monitoring).
 * 
 * **Usage**: This is the preferred entry point for manual sync triggers from the
 * dashboard UI, as it provides proper progress tracking. The cron scheduler uses
 * `syncAll` directly since it doesn't need UI progress updates.
 * 
 * **Lifecycle**:
 * 1. `startSync()` — marks sync as in-progress, resets progress bar state
 * 2. `syncAll()` — performs the actual data synchronization
 * 3. `touchLastSyncedAt()` — updates the timestamp of the last successful sync
 * 4. `completeSync(sent)` — marks sync as complete with total API request count
 * 
 * @returns The total number of sprints successfully synced (same as `syncAll()`)
 * @see syncAll - The underlying sync logic without lifecycle tracking
 */
export async function runFullSync(): Promise<number> {
  await startSync();
  const synced = await syncAll();
  await touchLastSyncedAt();
  await completeSync(zohoThrottle.sent);
  return synced;
}
