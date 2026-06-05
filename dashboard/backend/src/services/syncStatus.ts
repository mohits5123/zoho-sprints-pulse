import prisma from '../db/client';

const KEY = 'last_synced_at';

export async function getLastSyncedAt(): Promise<string | null> {
  const row = await prisma.settings.findUnique({ where: { key: KEY } });
  return row?.value ?? null;
}

export async function touchLastSyncedAt(): Promise<string> {
  const now = new Date().toISOString();
  await prisma.settings.upsert({
    where:  { key: KEY },
    update: { value: now },
    create: { key: KEY, value: now },
  });
  return now;
}
