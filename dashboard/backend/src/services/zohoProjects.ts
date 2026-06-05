import axios from 'axios';
import { getAccessToken } from './zohoAuth';
import { config } from '../config';
import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

export interface ZohoProject {
  zohoId: string;
  name: string;
  prefix: string | null;
  status: string;
  description: string | null;
  ownerName: string | null;
  ownerZohoId: string | null;
  createdTime: string | null;
  rawData: string;
}

const SETTINGS_KEY_TEAM_ID = 'zoho_team_id';

// Zoho Sprints encodes project status as integers
const PROJECT_STATUS_MAP: Record<number, string> = {
  1: 'active',
  2: 'inactive',
  3: 'archived',
  4: 'template',
};

async function resolveTeamId(): Promise<string> {
  const cached = await prisma.settings.findUnique({ where: { key: SETTINGS_KEY_TEAM_ID } });
  if (cached?.value) return cached.value;
  throw new Error('Team ID not found. Run user sync first to bootstrap the team ID.');
}

export async function fetchZohoProjects(): Promise<ZohoProject[]> {
  const token  = getAccessToken();
  const teamId = await resolveTeamId();
  const url    = `${config.zoho.apiBaseUrl}/team/${teamId}/projects/`;

  console.log('\n📦 Syncing projects');
  zohoThrottle.resetStats();

  const allProjects: ZohoProject[] = [];
  let index = 1;
  const RANGE = 100;

  while (true) {
    await zohoThrottle.wait(`projects/p${Math.ceil(index / RANGE)}`);
    const res = await axios.get(url, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      params: { action: 'allprojects', index, range: RANGE },
    });
    zohoThrottle.record(res.status);

    const raw = res.data;
    const projObj   = raw?.projectJObj   as Record<string, unknown[]>     | undefined;
    const prop      = raw?.project_prop  as Record<string, number>        ?? {};
    const prefixObj = raw?.prefixObj     as Record<string, string>        ?? {};
    const userNames = raw?.userDisplayName as Record<string, string>      ?? {};
    const projectIds: string[] = raw?.projectIds ?? (projObj ? Object.keys(projObj) : []);

    if (!projObj || projectIds.length === 0) {
      break;
    }

    // Field index mapping (from project_prop)
    const nameIdx   = prop.projName    ?? 0;
    const ownerIdx  = prop.owner       ?? 5;
    const timeIdx   = prop.createdTime ?? 9;
    const statusIdx = prop.status      ?? 15;

    for (const zpid of projectIds) {
      const fields = projObj[zpid];
      if (!fields) continue;

      const ownerZohoId = fields[ownerIdx] ? String(fields[ownerIdx]) : null;
      const statusCode  = typeof fields[statusIdx] === 'number' ? (fields[statusIdx] as number) : 1;

      allProjects.push({
        zohoId:      zpid,
        name:        String(fields[nameIdx] ?? 'Unknown'),
        prefix:      prefixObj[zpid] ?? null,
        status:      PROJECT_STATUS_MAP[statusCode] ?? 'active',
        description: null,
        ownerName:   ownerZohoId ? (userNames[ownerZohoId] ?? null) : null,
        ownerZohoId,
        createdTime: fields[timeIdx] ? String(fields[timeIdx]) : null,
        rawData:     JSON.stringify({ zpid, fields, prop, prefix: prefixObj[zpid] }),
      });
    }

    // Safely break if raw.next is false/missing OR if returned page size is smaller than requested
    if (!raw.next || projectIds.length < RANGE) break;
    index += RANGE;
  }

  zohoThrottle.printSummary();
  return allProjects;
}

export async function syncZohoProjects(): Promise<number> {
  const zohoProjects = await fetchZohoProjects();
  if (zohoProjects.length === 0) return 0;

  await Promise.all(
    zohoProjects.map((p) =>
      prisma.project.upsert({
        where:  { zohoId: p.zohoId },
        update: { name: p.name, prefix: p.prefix, status: p.status, description: p.description, ownerName: p.ownerName, ownerZohoId: p.ownerZohoId, createdTime: p.createdTime, rawData: p.rawData },
        create: { zohoId: p.zohoId, name: p.name, prefix: p.prefix, status: p.status, description: p.description, ownerName: p.ownerName, ownerZohoId: p.ownerZohoId, createdTime: p.createdTime, rawData: p.rawData },
      })
    )
  );

  return zohoProjects.length;
}
