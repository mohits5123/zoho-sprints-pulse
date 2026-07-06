import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';
import { fetchTeams } from './zohoTeams';

/**
 * Zoho user profile with basic information.
 *
 * This interface represents the minimal user data fetched from Zoho's /users/ endpoint.
 * Users are upserted to the database during sync and cached for runtime lookups.
 */
export interface ZohoUser {
  /** Unique Zoho user ID (used as primary key in DB) */
  zohoId: string;
  /** User display name from Zoho profile */
  name: string;
  /** Email address (null if not set in Zoho profile) */
  email: string | null;
}

/** Batch size for paginated user fetches (100 users per request). */
const BATCH_SIZE = 100;

/** Cache key for organization/team ID in Settings table. */
const SETTINGS_KEY_TEAM_ID       = 'zoho_team_id';

/** Cache key for workspace name in Settings table. */
const SETTINGS_KEY_WORKSPACE_NAME = 'zoho_workspace_name';

/**
 * Resolves the organization (team) ID used to scope all Zoho API calls.
 *
 * Strategy:
 * 1. Check the `Settings` table for a previously cached `zoho_team_id`.
 * 2. If missing, fetch from Zoho's `/teams/` endpoint via the shared
 *    15-minute in-memory cache (avoids redundant API calls).
 * 3. Cache the result back to `Settings` so subsequent calls are O(1).
 *
 * Also derives and caches a workspace slug from the org/team name.
 *
 * @returns The Zoho organization/team ID (`zsoid`)
 * @throws If the ID cannot be resolved from the Zoho response.
 */
async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;

  // First-time discovery — fetch from shared cache (hits Zoho only if cache expired)
  const teamsData = await fetchTeams();

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
 * Fetches **all** users from Zoho CRM and returns them as an array.
 *
 * The function paginates through every page of users using Zoho's `index`/`range`
 * parameters (100 users per page). Each page is rate-limited via `zohoThrottle`.
 *
 * Field positions inside Zoho's `userJObj` are read from the `user_prop`
 * configuration object returned alongside the data, making this resilient to
 * per-organization field reordering.
 *
 * **Side effects:**
 * - Resets and prints throttle stats for the current sync run.
 * - (The caller is responsible for upserting the returned users into the DB.)
 *
 * @returns An array of `ZohoUser` objects representing every user in the org.
 */
export async function fetchZohoUsers(): Promise<ZohoUser[]> {
  const token   = getAccessToken();
  const teamId  = await resolveTeamId();
  const usersUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/users/`;

  console.log('\nSyncing users');

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
      console.warn('userJObj missing from response');
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
