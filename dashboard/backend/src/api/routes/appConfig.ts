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
 * Resolves workspace name using a priority chain:
 * 1. Environment variable (highest priority, user-specified)
 * 2. Cached value from the local database settings table
 * 3. Auto-discovered from Zoho's /teams/ API (then cached for future requests)
 *
 * Falls back to an empty string if none of the above sources yield a name.
 * This fallback is non-fatal — the frontend continues with default UI values.
 *
 * @returns Promise resolving to a URL-safe workspace slug, or an empty string
 */
async function resolveWorkspaceName(): Promise<string> {
  // 1. Env var takes precedence (user-specified, configured at deploy time)
  if (config.zoho.workspaceName) return config.zoho.workspaceName;

  // 2. Check cached settings in the local database to avoid unnecessary API calls
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_WORKSPACE_NAME } });
  if (cached?.value) return cached.value;

  // 3. Discover from Zoho /teams/ API and cache it for subsequent requests
  try {
    // Requires an active OAuth session — throws if the user is not authenticated
    const token = getAccessToken();
    const res = await axios.get(
      `${config.zoho.apiBaseUrl}/teams/`,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
    );
    // Prefer teamName; fall back to orgName if teamName is absent
    const rawName: string = res.data?.portals?.[0]?.teamName ?? res.data?.portals?.[0]?.orgName ?? '';
    if (rawName) {
      // Normalise to a lowercase, space-free slug suitable for URLs and identifiers
      const slug = rawName.toLowerCase().replace(/\s+/g, '');
      await prisma.settings.upsert({
        where:  { key: SETTINGS_KEY_WORKSPACE_NAME },
        update: { value: slug },
        create: { key: SETTINGS_KEY_WORKSPACE_NAME, value: slug },
      });
      return slug;
    }
  } catch { /* non-fatal — Zoho API may be unreachable; frontend uses defaults */ }

  return '';
}

/**
 * GET /api/config — Returns frontend configuration values.
 *
 * Called by the frontend on initial page load so it can render the
 * workspace name in headers and cards without making a separate request.
 *
 * @route GET /api/config
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} JSON body — `{ workspaceName?: string }`
 *
 * Errors are swallowed intentionally: a failure here should never block
 * the frontend from loading (the UI falls back to default placeholders).
 */
router.get('/', async (_req, res) => {
  try {
    const workspaceName = await resolveWorkspaceName();
    res.json({ workspaceName });
  } catch (err) {
    // Non-fatal error — return empty workspace name so the frontend
    // continues rendering with default UI values instead of crashing.
    res.json({ workspaceName: '' });
  }
});

export default router;
