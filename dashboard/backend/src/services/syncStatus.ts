import prisma from '../db/client';

const KEY = 'last_synced_at';  // Key for storing last sync timestamp in Settings table

/**
 * Get the last successful sync timestamp from database.
 * Returns ISO string or null if never synced.
 */
export async function getLastSyncedAt(): Promise<string | null> {
  const row = await prisma.settings.findUnique({ where: { key: KEY } });
  return row?.value ?? null;
}

/**
 * Update the last sync timestamp in database.
 * Called after each successful sync completes.
 */
export async function touchLastSyncedAt(): Promise<string> {
  const now = new Date().toISOString();
  await prisma.settings.upsert({
    where:  { key: KEY },
    update: { value: now },
    create: { key: KEY, value: now },
  });
  return now;
}
