import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getAccessToken, getTokenExpiresAt } from '../../services/zohoAuth';
import { config } from '../../config';

const router = Router();

interface ZohoPortal {
  zsoid: string;
  teamName: string;
  orgName: string;
  type: string;
}

interface TeamsResponse {
  portals: ZohoPortal[];
  defaultPortalId: string;
  myTeamId: string;
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const token = getAccessToken();

    // GET /zsapi/teams/ — returns all workspaces/portals the user belongs to
    const teamsRes = await axios.get<TeamsResponse>(
      `${config.zoho.apiBaseUrl}/teams/`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );

    const { portals = [], defaultPortalId, myTeamId } = teamsRes.data;

    res.json({
      connected: true,
      tokenExpiresAt: new Date(getTokenExpiresAt()).toISOString(),
      myTeamId,
      defaultPortalId,
      portals: portals.map((p) => ({
        zsoid: p.zsoid,
        name: p.teamName,
        orgName: p.orgName,
        type: p.type,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    res.json({
      connected: false,
      error: message,
      ...(axios.isAxiosError(err) && {
        zohoStatus: err.response?.status,
        zohoUrl: err.config?.url,
      }),
    });
  }
});

export default router;
