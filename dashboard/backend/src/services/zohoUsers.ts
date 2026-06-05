import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

export interface ZohoUser {
  zohoId: string;
  name: string;
  email: string | null;
}

const BATCH_SIZE = 100;
const SETTINGS_KEY_TEAM_ID       = 'zoho_team_id';
const SETTINGS_KEY_WORKSPACE_NAME = 'zoho_workspace_name';

async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;

  // First-time discovery — fetch from Zoho /teams/
  const token = getAccessToken();
  await zohoThrottle.wait('teams/discover');
  const teamsRes = await axios.get(
    `${config.zoho.apiBaseUrl}/teams/`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  zohoThrottle.record(teamsRes.status);

  const teamsData = teamsRes.data;
  const zsoid: string | undefined =
    teamsData?.portals?.[0]?.zsoid ??
    teamsData?.defaultPortalId ??
    teamsData?.myTeamId;

  if (!zsoid || zsoid === '-1' || zsoid === '') {
    throw new Error('Could not determine organisation ID from Zoho /teams/ response.');
  }

  await prisma.settings.upsert({
    where:  { key: SETTINGS_KEY_TEAM_ID },
    update: { value: zsoid },
    create: { key: SETTINGS_KEY_TEAM_ID, value: zsoid },
  });

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

export async function fetchZohoUsers(): Promise<ZohoUser[]> {
  const token   = getAccessToken();
  const teamId  = await resolveTeamId();
  const usersUrl = `${config.zoho.apiBaseUrl}/team/${teamId}/users/`;

  console.log('\n👥 Syncing users');
  zohoThrottle.resetStats();
  const allUsers: ZohoUser[] = [];
  let index = 1;

  while (true) {
    await zohoThrottle.wait(`users/p${Math.ceil(index / BATCH_SIZE)}`);
    const res = await axios.get(usersUrl, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'data', index, range: BATCH_SIZE, type: 1 },
    });
    zohoThrottle.record(res.status);

    const raw = res.data;
    const userJObj = raw?.userJObj as Record<string, unknown[]> | undefined;

    if (!userJObj) {
      console.warn('⚠️  userJObj missing from response');
      break;
    }

    const prop: Record<string, number> = raw.user_prop ?? {};
    const nameIdx  = prop.displayName ?? 0;
    const emailIdx = prop.emailId     ?? 1;
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

    // Safely break if raw.next is false/missing OR if returned page size is smaller than requested
    if (!raw.next || userIds.length < BATCH_SIZE) break;
    index += BATCH_SIZE;
  }

  zohoThrottle.printSummary();
  return allUsers;
}
