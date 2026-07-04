/**
 * Status API - Zoho API connectivity and OAuth token status.
 *
 * Checks if the current OAuth token is valid by calling the cached
 * `fetchTeams()` function (which hits Zoho /teams/ endpoint at most
 * once per 15 minutes). Returns portal information, token expiry time,
 * and identifies the default/my team.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken, getTokenExpiresAt } from '../../services/zohoAuth';
import { fetchTeams, ZohoPortal } from '../../services/zohoTeams';

const router = Router();

/**
 * GET /api/status — Check Zoho API connectivity and OAuth token status.
 *
 * Uses the cached `fetchTeams()` function which only hits Zoho's `/teams/`
 * endpoint if the cache has expired (15-minute TTL). This prevents spamming
 * the Zoho API on every dashboard refresh.
 *
 * @route GET /api/status
 * @method GET
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from session)
 * @returns {Object} - Status object with connectivity and OAuth details
 * @auth Required (OAuth token validation via getAccessToken())
 * @responses
 *   On success: { connected: true, tokenExpiresAt: ISO_DATETIME, myTeamId: string, defaultPortalId: string, portals: [...] }
 *   On failure: { connected: false, error: string, zohoStatus?: number, zohoUrl?: string }
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Validate that we have an access token before attempting the API call.
    // If no token is present, getAccessToken() returns an empty string;
    // the Zoho API will respond with a 401 which we surface as an error below.
    const token = getAccessToken();
    if (!token) {
      throw new Error('No OAuth token available');
    }

    // Fetch teams data — uses 15-minute in-memory cache to avoid
    // redundant API calls on every dashboard refresh.
    const teamsData = await fetchTeams();
    const { portals = [], defaultPortalId, myTeamId } = teamsData;

    res.json({
      connected: true,
      tokenExpiresAt: new Date(getTokenExpiresAt()).toISOString(),
      myTeamId,
      defaultPortalId,
      // Flatten the portal shape for the client: rename `teamName` → `name`
      // so the frontend doesn't need to know Zoho's internal field naming.
      portals: portals.map((p: ZohoPortal) => ({
        zsoid: p.zsoid,
        name: p.teamName,
        orgName: p.orgName,
        type: p.type,
      })),
    });
  } catch (err: unknown) {
    // Narrow `unknown` to `Error` to safely read `.message`.
    const message = err instanceof Error ? err.message : 'Unknown error';

    res.json({
      connected: false,
      error: message,
      // Attach HTTP-level diagnostics only when the error is an Axios error
      // so the client can distinguish between network errors and Zoho API errors.
      ...(axios.isAxiosError(err) && {
        zohoStatus: err.response?.status,
        zohoUrl: err.config?.url,
      }),
    });
  }
});

export default router;
