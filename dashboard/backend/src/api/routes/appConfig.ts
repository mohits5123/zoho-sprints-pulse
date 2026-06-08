/**
 * App Config API - Frontend configuration values.
 *
 * Resolves the Zoho workspace name using a priority chain:
 * 1. Environment variable (user-specified)
 * 2. Cached settings from local database
 * 3. Auto-discovered from Zoho /teams/ API (cached for future use)
 *
 * This endpoint is called by the frontend on initial load to display
 * workspace name in headers and cards.
 */

import { Router } from 'express';
import axios from 'axios';
import { config } from '../../config';
import { getAccessToken } from '../../services/zohoAuth';
import prisma from '../../db/client';

const router = Router();
const SETTINGS_KEY_WORKSPACE_NAME = 'zoho_workspace_name';

/**
 * Resolves workspace name using priority chain.
 * @returns Promise resolving to workspace slug or empty string if not found
 */
async function resolveWorkspaceName(): Promise<string> {
  // 1. Env var takes precedence (user-specified)
  if (config.zoho.workspaceName) return config.zoho.workspaceName;

  // 2. Check cached settings
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_WORKSPACE_NAME } });
  if (cached?.value) return cached.value;

  // 3. Discover from Zoho /teams/ API and cache it
  try {
    const token = getAccessToken();
    const res = await axios.get(
      `${config.zoho.apiBaseUrl}/teams/`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    const rawName: string = res.data?.portals?.[0]?.teamName ?? res.data?.portals?.[0]?.orgName ?? '';
    if (rawName) {
      const slug = rawName.toLowerCase().replace(/\s+/g, '');
      await prisma.settings.upsert({
        where:  { key: SETTINGS_KEY_WORKSPACE_NAME },
        update: { value: slug },
        create: { key: SETTINGS_KEY_WORKSPACE_NAME, value: slug },
      });
      return slug;
    }
  } catch { /* non-fatal - discovered workspace name is not required */ }

  return '';
}

/**
 * GET /api/config — Returns frontend configuration values.
 * @route GET /api/config
 * @method GET
 * @headers Content-Type: application/json, Authorization: Zoho-oauthtoken (from authenticated session)
 * @returns {Object} - { workspaceName?: string }
 * @auth Required (OAuth token validation via getAccessToken())
 */
router.get('/', async (_req, res) => {
  try {
    const workspaceName = await resolveWorkspaceName();
    res.json({ workspaceName });
  } catch (err) {
    // Non-fatal error - return empty workspace name, frontend continues with default UI
    res.json({ workspaceName: '' });
  }
});

export default router;
