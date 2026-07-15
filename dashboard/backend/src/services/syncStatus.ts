import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

const KEY = 'last_synced_at';
const SYNC_IN_PROGRESS_KEY = 'sync_in_progress';
const SYNC_TOTAL_REQUESTS_KEY = 'sync_total_requests';
const SYNC_START_TIME_KEY = 'sync_start_time';
const SYNCED_SPRINT_IDS_KEY = 'synced_sprint_ids';
const SYNC_COMPLETED_SUCCESSFULLY_KEY = 'sync_completed_successfully';
const SYNC_FAILED_REQUESTS_KEY = 'sync_failed_requests';

const pendingSyncedSprintIds = new Set<string>();

export interface SyncMetadata {
  syncStartTime: string | null;
  syncedSprintIds: string[];
  completedSuccessfully: boolean;
  failedRequests: number;
}

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

export async function startSync(): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'true' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'true' },
  });
  await prisma.settings.upsert({
    where:  { key: SYNC_START_TIME_KEY },
    update: { value: new Date().toISOString() },
    create: { key: SYNC_START_TIME_KEY, value: new Date().toISOString() },
  });
  await prisma.settings.upsert({
    where:  { key: SYNCED_SPRINT_IDS_KEY },
    update: { value: '[]' },
    create: { key: SYNCED_SPRINT_IDS_KEY, value: '[]' },
  });
  await prisma.settings.upsert({
    where:  { key: SYNC_COMPLETED_SUCCESSFULLY_KEY },
    update: { value: 'false' },
    create: { key: SYNC_COMPLETED_SUCCESSFULLY_KEY, value: 'false' },
  });
  await prisma.settings.upsert({
    where:  { key: SYNC_FAILED_REQUESTS_KEY },
    update: { value: '0' },
    create: { key: SYNC_FAILED_REQUESTS_KEY, value: '0' },
  });
}

export function recordSyncedSprint(sprintId: string): void {
  pendingSyncedSprintIds.add(sprintId);
}

export async function flushSyncedSprintIds(): Promise<void> {
  if (pendingSyncedSprintIds.size === 0) return;
  const ids = Array.from(pendingSyncedSprintIds);
  pendingSyncedSprintIds.clear();
  await prisma.settings.upsert({
    where:  { key: SYNCED_SPRINT_IDS_KEY },
    update: { value: JSON.stringify(ids) },
    create: { key: SYNCED_SPRINT_IDS_KEY, value: JSON.stringify(ids) },
  });
}

export async function completeSync(totalRequests: number, failedRequests: number): Promise<void> {
  const completedSuccessfully = failedRequests === 0;
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
  await prisma.settings.upsert({
    where:  { key: SYNC_COMPLETED_SUCCESSFULLY_KEY },
    update: { value: completedSuccessfully ? 'true' : 'false' },
    create: { key: SYNC_COMPLETED_SUCCESSFULLY_KEY, value: completedSuccessfully ? 'true' : 'false' },
  });
  await prisma.settings.upsert({
    where:  { key: SYNC_FAILED_REQUESTS_KEY },
    update: { value: String(failedRequests) },
    create: { key: SYNC_FAILED_REQUESTS_KEY, value: String(failedRequests) },
  });
}

export async function getSyncMetadata(): Promise<SyncMetadata> {
  const [startTimeRow, sprintIdsRow, completedRow, failedRow] = await Promise.all([
    prisma.settings.findUnique({ where: { key: SYNC_START_TIME_KEY } }),
    prisma.settings.findUnique({ where: { key: SYNCED_SPRINT_IDS_KEY } }),
    prisma.settings.findUnique({ where: { key: SYNC_COMPLETED_SUCCESSFULLY_KEY } }),
    prisma.settings.findUnique({ where: { key: SYNC_FAILED_REQUESTS_KEY } }),
  ]);
  return {
    syncStartTime: startTimeRow?.value ?? null,
    syncedSprintIds: sprintIdsRow ? JSON.parse(sprintIdsRow.value) : [],
    completedSuccessfully: completedRow?.value === 'true',
    failedRequests: failedRow ? parseInt(failedRow.value, 10) : 0,
  };
}

/**
 * Resets the sync in-progress flag to `'false'`.
 *
 * This is a recovery function used in two scenarios:
 * 1. **Server restart** — if the server was running a sync when it crashed,
 *    the flag would still be `'true'` on restart. Calling this clears the
 *    stale flag so normal sync operations can resume.
 * 2. **Error recovery** — if a sync fails or is aborted mid-way, this ensures
 *    subsequent syncs are not blocked by a lingering in-progress flag.
 *
 * Note: This function does **not** reset the total request count. Callers
 * should handle that separately if needed.
 */
export async function resetSyncProgress(): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'false' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'false' },
  });
}

/**
 * Reads the current sync progress state from the database and in-memory
 * throttle counter, returning a snapshot suitable for the frontend
 * progress indicator.
 *
 * **How progress is calculated:**
 * - `inProgress` — derived from the `sync_in_progress` database flag.
 * - `totalRequests` — the total request count from the most recent sync
 *   (stored at sync completion). On the first sync this is `0`.
 * - `requestsMade` — read from `zohoThrottle.sent`, an in-memory counter
 *   that tracks API requests made during the *current* sync cycle.
 * - `percentage` — computed as `min(100, round(requestsMade / totalRequests * 100))`
 *   when `totalRequests > 0`. Returns `null` on the very first sync because
 *   there is no historical total to compare against. The frontend renders a
 *   default (indeterminate) width when percentage is `null`.
 * - `isFirstSync` — `true` when `totalRequests` is `0`, indicating no sync
 *   has completed yet.
 *
 * **Thread-safety note:** `requestsMade` comes from an in-memory counter and
 * is only accurate within a single process. If the server restarts mid-sync,
 * the counter resets but the `sync_in_progress` flag persists, so the
 * frontend will show stale progress until a new sync begins.
 *
 * @returns An object describing the current sync state.
 */
export async function getSyncProgress(): Promise<{
  /** Whether a sync operation is currently running. */
  inProgress: boolean;
  /**
   * Progress percentage (0–100), or `null` on the very first sync when
   * no historical total is available.
   */
  percentage: number | null;
  /** Number of API requests made during the current sync cycle. */
  requestsMade: number;
  /** Total requests from the most recent completed sync. */
  totalRequests: number;
  /** True when no sync has ever completed (first-run scenario). */
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
