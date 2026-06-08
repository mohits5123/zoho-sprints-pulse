import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

/** Zoho project with metadata. */
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

/** Zoho project status codes mapped to human-readable values. */
const PROJECT_STATUS_MAP: Record<number, string> = {
  1: 'active',      // Currently active project
  2: 'inactive',    // Temporarily inactive (not archived)
  3: 'archived',    // Project has been archived, no new work
  4: 'template',    // Reusable template project
};

/** Cache key for organization/team ID in Settings table. */
const SETTINGS_KEY_TEAM_ID = 'zoho_team_id';

/**
 * Resolve the organization/team ID from Settings cache.
 * Throws if not found (requires user sync to run first).
 */
async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;
  
  throw new Error('Team ID not found. Run user sync first to bootstrap the team ID.');
}

/**
 * Fetch all projects from Zoho and upsert to database.
 * Uses pagination with 100 projects per request.
 * 
 * Projects are upserted by zohoId — only metadata changes (name, status, owner).
 * This is a top-level project list that doesn't include sprints/epics/issues.
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
 * Sync Zoho projects to database.
 * Fetches from Zoho and upserts all active/inactive/archived/template projects.
 * 
 * @returns Number of projects synced (upserted)
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
