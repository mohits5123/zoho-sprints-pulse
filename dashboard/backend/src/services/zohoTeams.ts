/**
 * Zoho Teams API service with in-memory caching.
 *
 * Provides a cached wrapper around Zoho's `/teams/` endpoint to avoid
 * redundant API calls. The response is cached in memory for 15 minutes,
 * preventing rate-limit pressure when multiple callers (status checks,
 * config resolution, team ID discovery) need the same data within a
 * short window.
 *
 * Cache behavior:
 * - First call: hits Zoho API, stores response + timestamp.
 * - Subsequent calls within 15 minutes: returns cached data (no API call).
 * - Calls after 15 minutes: cache expires, next call hits Zoho API again.
 *
 * This is especially important for the `/api/status` endpoint, which is
 * called on every dashboard refresh and would otherwise hit Zoho every time.
 */

import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import { zohoThrottle } from './rateLimiter';

/**
 * Zoho portal/workspace information returned by the `/teams/` endpoint.
 */
export interface ZohoPortal {
  /** Zoho portal ID (unique identifier for the workspace). */
  zsoid: string;
  /** Team/workspace name as shown in Zoho UI. */
  teamName: string;
  /** Organization name if different from team name. */
  orgName: string;
  /** Portal type (e.g., 'team', 'org'). */
  type: string;
}

/**
 * Shape of the response from Zoho's `/teams/` endpoint.
 */
export interface TeamsResponse {
  /** Array of workspaces/portals the authenticated user belongs to. */
  portals: ZohoPortal[];
  /** Default portal ID for API calls. */
  defaultPortalId: string;
  /** The team this user is primarily associated with. */
  myTeamId: string;
}

/**
 * Duration (in milliseconds) for which the `/teams/` response is cached.
 *
 * Set to 15 minutes to balance between:
 * - Reducing API calls (Zoho rate limit: 25 req/min)
 * - Keeping data reasonably fresh (team info rarely changes)
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory cache entry holding the teams response and its expiry timestamp.
 *
 * `null` indicates the cache has not been populated yet (first run).
 */
interface TeamsCacheEntry {
  /** The cached response from Zoho's `/teams/` endpoint. */
  data: TeamsResponse;
  /** Unix timestamp (milliseconds) at which this cache entry expires. */
  expiresAt: number;
}

/**
 * Module-level cache for the `/teams/` response.
 *
 * Shared across all callers within the same server process. Survives
 * multiple requests but is reset on server restart (intentional — forces
 * a fresh fetch on cold start to pick up any team changes).
 */
let teamsCache: TeamsCacheEntry | null = null;

/**
 * Fetches the list of Zoho teams/portals, using an in-memory cache to
 * avoid redundant API calls.
 *
 * Call chain:
 * 1. Check if cache exists and is not expired → return cached data.
 * 2. Otherwise, call Zoho `/teams/` API, store result in cache, return data.
 *
 * Rate limiting is applied via `zohoThrottle` before the API call.
 *
 * @returns The teams response containing portals, defaultPortalId, and myTeamId.
 * @throws If the Zoho API call fails (network error, auth error, etc.).
 *
 * @example
 *   const teams = await fetchTeams();
 *   console.log(teams.portals[0].teamName); // "My Workspace"
 */
export async function fetchTeams(): Promise<TeamsResponse> {
  // Return cached data if it exists and hasn't expired
  if (teamsCache && Date.now() < teamsCache.expiresAt) {
    return teamsCache.data;
  }

  // Cache miss or expired — fetch fresh data from Zoho
  const token = getAccessToken();
  await zohoThrottle.wait('teams/discover');
  const res = await axios.get<TeamsResponse>(
    `${config.zoho.apiBaseUrl}/teams/`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  zohoThrottle.record(res.status);

  // Populate cache with the fresh response and set expiry
  teamsCache = {
    data: res.data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return res.data;
}
