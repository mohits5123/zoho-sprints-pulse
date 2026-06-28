/**
 * Status API - Zoho API connectivity and OAuth token status.
 *
 * Checks if the current OAuth token is valid by calling Zoho /teams/ endpoint.
 * Returns portal information, token expiry time, and identifies the default/my team.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken, getTokenExpiresAt } from '../../services/zohoAuth';
import { config } from '../../config';

const router = Router();

/**
 * Zoho portal/workspace information.
 */
interface ZohoPortal {
  zsoid: string;      // Zoho portal ID (unique identifier)
  teamName: string;   // Team/workspace name as shown in Zoho UI
  orgName: string;    // Organization name if different from team name
  type: string;       // Portal type (e.g., 'team', 'org')
}

/**
 * Zoho /teams/ API response structure.
 */
interface TeamsResponse {
  portals: ZohoPortal[];   // Array of workspaces the user belongs to
  defaultPortalId: string; // Default portal ID for API calls
  myTeamId: string;        // The team this user is primarily associated with
}

/**
 * GET /api/status — Check Zoho API connectivity and OAuth token status.
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
    const token = getAccessToken();

    // If no token is present, getAccessToken() returns an empty string;
    // the Zoho API will respond with a 401 which we surface as an error below.
    // GET /zsapi/teams/ — returns all workspaces/portals the user belongs to
    const teamsRes = await axios.get<TeamsResponse>(
      `${config.zoho.apiBaseUrl}/teams/`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );

    // Destructure with a fallback so the response is never undefined
    // if Zoho omits the `portals` key in an unexpected response shape.
    const { portals = [], defaultPortalId, myTeamId } = teamsRes.data;

    res.json({
      connected: true,
      tokenExpiresAt: new Date(getTokenExpiresAt()).toISOString(),
      myTeamId,
      defaultPortalId,
      // Flatten the portal shape for the client: rename `teamName` → `name`
      // so the frontend doesn't need to know Zoho's internal field naming.
      portals: portals.map((p) => ({
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
