import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

/**
 * Represents a Zoho project with normalized metadata stored in our database.
 *
 * This interface mirrors the shape of records in the `Project` Prisma model.
 * Fields like `description` and `prefix` may be null since Zoho's API does not
 * always return them.
 */
export interface ZohoProject {
  zohoId: string;        // Unique Zoho project ID
  name: string;          // Project display name
  prefix: string | null; // Item numbering prefix (e.g., "PROJ-" for "PROJ-123")
  status: string;        // One of: active, inactive, archived, template
  description: string | null;   // Project description (often null in API)
  ownerName: string | null;    // Owner display name (from user lookup)
  ownerZohoId: string | null;   // Owner's Zoho ID
  createdTime: string | null;  // ISO timestamp when project was created
  rawData: string;        // JSON blob of raw response for debugging/replay
}

/**
 * Maps Zoho's integer status codes to human-readable status strings.
 *
 * Zoho Projects returns status as a number; this table translates it
 * into one of four canonical values used throughout the app.
 *
 * | Code | Status   | Meaning                                       |
 * |------|----------|-----------------------------------------------|
 * | 1    | active   | Currently active project                      |
 * | 2    | inactive | Temporarily inactive (not archived)           |
 * | 3    | archived | Project has been archived, no new work        |
 * | 4    | template | Reusable template project                     |
 */
const PROJECT_STATUS_MAP: Record<number, string> = {
  1: 'active',      // Currently active project
  2: 'inactive',    // Temporarily inactive (not archived)
  3: 'archived',    // Project has been archived, no new work
  4: 'template',    // Reusable template project
};

/** Cache key for organization/team ID in Settings table. */
const SETTINGS_KEY_TEAM_ID = 'zoho_team_id';

/**
 * Resolve the organization/team ID from the Settings cache table.
 *
 * This value is written during the initial user sync and is required
 * to construct the Zoho API URL for fetching projects.
 *
 * @throws {Error} If the team ID has not been bootstrapped yet.
 *                 Call the user sync routine first.
 * @returns The team/organization ID as a string.
 */
async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;
  
  throw new Error('Team ID not found. Run user sync first to bootstrap the team ID.');
}

/**
 * Fetch all projects from Zoho's API and return them as normalized `ZohoProject` objects.
 *
 * This function handles:
 * - Authentication via the cached access token from `zohoAuth`.
 * - Pagination through all projects (100 per page) using Zoho's `index` and `range` params.
 * - Rate-limiting via `zohoThrottle` to stay within Zoho's API quotas.
 * - Field-index resolution from `project_prop`, which varies per organization.
 * - Owner name lookup using the `userDisplayName` map from Zoho's response.
 *
 * Notes:
 * - `description` is always `null` because Zoho's `allprojects` endpoint does not
 *   return it. To get descriptions you would need to call the individual project
 *   detail endpoint (not done here for performance).
 * - Archived projects are included because the `action=allprojects` parameter
 *   is used instead of `action=activeprojects`.
 * - Sprints, epics, and issues are NOT fetched; this is a top-level project list only.
 *
 * @returns An array of all projects belonging to the organization's Zoho team.
 * @throws {Error} If the team ID is missing from the Settings cache.
 */
export async function fetchZohoProjects(): Promise<ZohoProject[]> {
  const token  = getAccessToken();
  const teamId = await resolveTeamId();
  
  // All projects endpoint (not filtered by board type)
  const url    = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/`;

  console.log('\n📦 Syncing projects');
  
  // Reset stats for this sync run
  zohoThrottle.resetStats();
  
  const allProjects: ZohoProject[] = [];
  let index = 1;
  const RANGE = 100;

  // Paginate through all projects using Zoho's page indexing
  while (true) {
    await zohoThrottle.wait(`projects/p${Math.ceil(index / RANGE)}`);
    
    const res = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'allprojects', index, range: RANGE },  // allprojects includes archived
    });
    
    zohoThrottle.record(res.status);

    const raw = res.data;
    
    // projectJObj contains detailed project data indexed by Zoho ID
    const projObj   = raw?.projectJObj   as Record<string, unknown[]>     | undefined;
    const prop      = raw?.project_prop  as Record<string, number>        ?? {};
    
    // prefixObj maps zohoId -> prefix string (optional for each project)
    const prefixObj = raw?.prefixObj     as Record<string, string>        ?? {};
    
    // userDisplayName maps zohoId -> display name for owner lookup
    const userNames = raw?.userDisplayName as Record<string, string>      ?? {};
    
    // projectId -> [zohoId1, zohoId2, ...] mapping
    const projectIds: string[] = raw?.projectIds ?? (projObj ? Object.keys(projObj) : []);

    if (!projObj || projectIds.length === 0) {
      break;
    }

    // Extract field indices from project_prop (configurable per organization)
    const nameIdx   = prop.projName    ?? 0;
    const ownerIdx  = prop.owner       ?? 5;
    const timeIdx   = prop.createdTime ?? 9;
    const statusIdx = prop.status      ?? 15;

    for (const zpid of projectIds) {
      const fields = projObj[zpid];
      if (!fields) continue;

      // Owner Zoho ID: 0-indexed into fields array
      const ownerZohoId = fields[ownerIdx] ? String(fields[ownerIdx]) : null;
      
      // Status: can be string (already mapped) or number (needs mapping)
      const statusCode  = typeof fields[statusIdx] === 'number' ? (fields[statusIdx] as number) : 1;
      
      // Build project record with normalized status and owner name lookup
      allProjects.push({
        zohoId:      zpid,
        name:        String(fields[nameIdx] ?? 'Unknown'),
        prefix:      prefixObj[zpid] ?? null,
        status:      PROJECT_STATUS_MAP[statusCode] ?? 'active',
        description: null,  // Not typically returned by Zoho projects endpoint
        ownerName:   ownerZohoId ? (userNames[ownerZohoId] ?? null) : null,
        ownerZohoId,
        createdTime: fields[timeIdx] ? String(fields[timeIdx]) : null,
        
        // Store raw data for debugging/replay (serialized JSON)
        rawData:     JSON.stringify({ zpid, fields, prop, prefix: prefixObj[zpid] }),
      });
    }

    // Safely break if raw.next is false/missing OR if returned page size < requested
    if (!raw.next || projectIds.length < RANGE) break;
    index += RANGE;
  }

  // Print summary after sync completes
  zohoThrottle.printSummary();
  
  return allProjects;
}

/**
 * Sync Zoho projects to the local database.
 *
 * This is the main entry point for keeping project metadata in sync. It:
 * 1. Calls `fetchZohoProjects()` to retrieve and normalize all projects from Zoho.
 * 2. Upserts each project into the `Project` Prisma model by `zohoId`.
 *    - On update, only overwrites fields that come from Zoho (preserving any
 *      custom/local fields that may have been added).
 *    - On create, populates all fields from the Zoho response.
 *
 * This function is idempotent — calling it multiple times with the same Zoho
 * state will produce no net changes after the first sync.
 *
 * @returns The number of projects that were fetched and upserted.
 *          Returns `0` if no projects were returned by Zoho.
 */
export async function syncZohoProjects(): Promise<number> {
  const zohoProjects = await fetchZohoProjects();
  
  if (zohoProjects.length === 0) return 0;

  // Upsert all projects in parallel (by zohoId)
  await Promise.all(
    zohoProjects.map((p) =>
      prisma.project.upsert({
        where:  { zohoId: p.zohoId },
        
        // Update only if exists (merges with any manually created custom fields)
        update: { 
          name: p.name, prefix: p.prefix, status: p.status, 
          description: p.description, ownerName: p.ownerName, 
          ownerZohoId: p.ownerZohoId, createdTime: p.createdTime, 
          rawData: p.rawData 
        },
        
        // Create if not exists (with all fields)
        create: { 
          zohoId: p.zohoId, name: p.name, prefix: p.prefix, 
          status: p.status, description: p.description, 
          ownerName: p.ownerName, ownerZohoId: p.ownerZohoId, 
          createdTime: p.createdTime, rawData: p.rawData 
        },
      })
    )
  );

  return zohoProjects.length;
}
