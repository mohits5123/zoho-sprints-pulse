import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

/**
 * Zoho user profile with basic information.
 * 
 * This interface represents the minimal user data fetched from Zoho's /users/ endpoint.
 * Users are upserted to the database during sync and cached for runtime lookups.
 */
export interface ZohoUser {
  zohoId: string;    // Unique Zoho user ID (used as primary key in DB)
  name: string;      // User display name from Zoho profile
  email: string | null;   // Email address (null if not set in Zoho profile)
}

/** Batch size for paginated user fetches (100 users per request). */
const BATCH_SIZE = 100;

/** Cache key for organization/team ID in Settings table. */
const SETTINGS_KEY_TEAM_ID       = 'zoho_team_id';

/** Cache key for workspace name in Settings table. */
const SETTINGS_KEY_WORKSPACE_NAME = 'zoho_workspace_name';

/**
 * Resolve the organization/team ID from Zoho API.
 * 
 * First checks Settings cache for previously resolved team ID. If not found,
 * fetches from Zoho /teams/ endpoint on first run and caches the result.
 * 
 * @returns The Zoho organization/team ID (zsoid)
 */
async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;

  // First-time discovery — fetch from Zoho /teams/ endpoint
  const token = getAccessToken();
  await zohoThrottle.wait('teams/discover');
  const teamsRes = await axios.get(
    `${config.zoho.apiBaseUrl}/teams/`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  zohoThrottle.record(teamsRes.status);

  const teamsData = teamsRes.data;
  
  // Extract organization ID from Zoho response (multiple possible fields)
  const zsoid: string | undefined =
    teamsData?.portals?.[0]?.zsoid ??
    teamsData?.defaultPortalId ??
    teamsData?.myTeamId;

  if (!zsoid || zsoid === '-1' || zsoid === '') {
    throw new Error('Could not determine organisation ID from Zoho /teams/ response.');
  }

  // Cache the team ID for future calls
  await prisma.settings.upsert({
    where:  { key: SETTINGS_KEY_TEAM_ID },
    update: { value: zsoid },
    create: { key: SETTINGS_KEY_TEAM_ID, value: zsoid },
  });

  // Also cache workspace name (derived from org/team name)
  const rawName: string = teamsData?.portals?.[0]?.teamName ?? teamsData?.portals?.[0]?.orgName ?? '';
  if (rawName) {
    const workspaceSlug = rawName.toLowerCase().replace(/\s+/g, '');
    await prisma.settings.upsert({
      where:  { key: SETTINGS_KEY_WORKSPACE_NAME },
      update: { value: workspaceSlug },
      create: { key: SETTINGS_KEY_WORKSPACE_NAME, value: workspaceSlug },
    });
  }

  return zsoid;
}

/**
 * Fetch all users from Zoho and upsert to database.
 * Uses pagination with batch size of 100 users per request.
 */
export async function fetchZohoUsers(): Promise<ZohoUser[]> {
  const token   = getAccessToken();
  const teamId  = await resolveTeamId();
  const usersUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/users/`;

  console.log('\n👥 Syncing users');
  
  // Reset stats for this sync run
  zohoThrottle.resetStats();
  const allUsers: ZohoUser[] = [];
  let index = 1;

  // Paginate through all users using Zoho's page indexing
  while (true) {
    await zohoThrottle.wait(`users/p${Math.ceil(index / BATCH_SIZE)}`);
    const res = await axios.get(usersUrl, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index, range: BATCH_SIZE, type: 1 },
    });
    zohoThrottle.record(res.status);

    const raw = res.data;
    
    // userJObj contains the detailed user data indexed by Zoho ID
    const userJObj = raw?.userJObj as Record<string, unknown[]> | undefined;

    if (!userJObj) {
      console.warn('⚠️  userJObj missing from response');
      break;
    }

    // Extract field indices from user_prop (configurable per organization)
    const prop: Record<string, number> = raw.user_prop ?? {};
    const nameIdx  = prop.displayName ?? 0;
    const emailIdx = prop.emailId     ?? 1;
    
    // Map Zoho user IDs to this page's data
    const userIds: string[] = raw.userIds ?? Object.keys(userJObj);

    for (const zpuid of userIds) {
      const fields = userJObj[zpuid];
      if (!fields) continue;
      
      allUsers.push({
        zohoId: zpuid,
        name:   String(fields[nameIdx]  ?? 'Unknown'),
        email:  fields[emailIdx] ? String(fields[emailIdx]) : null,
      });
    }

    // Safely break if raw.next is false/missing OR if returned page size < requested
    if (!raw.next || userIds.length < BATCH_SIZE) break;
    index += BATCH_SIZE;
  }

  // Print summary after sync completes
  zohoThrottle.printSummary();
  
  return allUsers;
}
