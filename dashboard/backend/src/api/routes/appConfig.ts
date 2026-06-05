import { Router } from 'express';
import axios from 'axios';
import { config } from '../../config';
import { getAccessToken } from '../../services/zohoAuth';
import prisma from '../../db/client';

const router = Router();
const SETTINGS_KEY_WORKSPACE_NAME = 'zoho_workspace_name';

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
  } catch { /* non-fatal */ }

  return '';
}

// GET /api/config — frontend configuration values
router.get('/', async (_req, res) => {
  try {
    const workspaceName = await resolveWorkspaceName();
    res.json({ workspaceName });
  } catch (err) {
    res.json({ workspaceName: '' });
  }
});

export default router;
