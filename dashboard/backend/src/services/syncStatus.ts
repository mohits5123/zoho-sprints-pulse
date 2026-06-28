import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

const KEY = 'last_synced_at';

const SYNC_IN_PROGRESS_KEY = 'sync_in_progress';
const SYNC_TOTAL_REQUESTS_KEY = 'sync_total_requests';

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

/**
 * Mark a sync as in-progress.
 * Called at the start of a sync operation.
 */
export async function startSync(): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'true' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'true' },
  });
}

/**
 * Mark sync as complete (clears the in-progress flag and stores the
 * total request count for future progress calculations).
 * Called at the end of a successful sync operation.
 */
export async function completeSync(totalRequests: number): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'false' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'false' },
  });
  await prisma.settings.upsert({
    where:  { key: SYNC_TOTAL_REQUESTS_KEY },
    update: { value: String(totalRequests) },
    create: { key: SYNC_TOTAL_REQUESTS_KEY, value: String(totalRequests) },
  });
}

/**
 * Reset sync in-progress flag (used on server restart or error recovery).
 */
export async function resetSyncProgress(): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'false' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'false' },
  });
}

/**
 * Get current sync progress state.
 * Reads in-memory request count from zohoThrottle.
 * Percentage is null during sync since the total expected requests
 * is not known upfront (depends on number of projects/sprints).
 * The frontend shows a default width when percentage is null.
 */
export async function getSyncProgress(): Promise<{
  inProgress: boolean;
  percentage: number | null;
  requestsMade: number;
  totalRequests: number;
  isFirstSync: boolean;
}> {
  const inProgressRow = await prisma.settings.findUnique({ where: { key: SYNC_IN_PROGRESS_KEY } });
  const totalRow = await prisma.settings.findUnique({ where: { key: SYNC_TOTAL_REQUESTS_KEY } });

  const inProgress = inProgressRow?.value === 'true';
  const totalRequests = totalRow ? parseInt(totalRow.value, 10) : 0;
  const isFirstSync = totalRequests === 0;
  const requestsMade = zohoThrottle.sent;

  // Percentage is calculable whenever totalRequests is known.
  let percentage: number | null = null;
  if (totalRequests > 0) {
    percentage = Math.min(100, Math.round((requestsMade / totalRequests) * 100));
  }

  return {
    inProgress,
    percentage,
    requestsMade,
    totalRequests,
    isFirstSync,
  };
}
