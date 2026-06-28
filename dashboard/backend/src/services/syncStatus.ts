import prisma from '../db/client';
import { zohoThrottle } from './rateLimiter';

/**
 * Database key used to store the timestamp of the last successful sync.
 */
const KEY = 'last_synced_at';

/**
 * Database key used as a boolean flag to indicate whether a sync operation
 * is currently running. Prevents concurrent syncs and enables recovery
 * on server restart or crash.
 */
const SYNC_IN_PROGRESS_KEY = 'sync_in_progress';

/**
 * Database key used to store the total number of API requests made during
 * the most recent sync. This value is written at the end of a sync and is
 * used to calculate progress percentage for subsequent syncs.
 */
const SYNC_TOTAL_REQUESTS_KEY = 'sync_total_requests';

/**
 * Retrieves the timestamp of the most recent successful sync from the database.
 *
 * This is used to determine which records need to be fetched during incremental
 * syncs — only resources modified after this timestamp are requested from the
 * Zoho API.
 *
 * @returns An ISO-8601 string representing the last sync time, or `null` if
 *          the system has never completed a sync.
 *
 * @example
 *   const lastSync = await getLastSyncedAt();
 *   // "2024-01-15T08:30:00.000Z" or null
 */
export async function getLastSyncedAt(): Promise<string | null> {
  const row = await prisma.settings.findUnique({ where: { key: KEY } });
  return row?.value ?? null;
}

/**
 * Records the current time as the last successful sync timestamp.
 *
 * Uses `upsert` to either update the existing row or create a new one if the
 * key does not yet exist (e.g., on first sync). This function is called at the
 * end of every successful sync cycle so that subsequent incremental syncs know
 * where to resume from.
 *
 * @returns The ISO-8601 string that was stored in the database.
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
 * Marks a sync operation as in-progress by setting the `sync_in_progress` flag
 * to `'true'` in the database.
 *
 * This serves two purposes:
 * 1. **Concurrency guard** — prevents multiple sync operations from running
 *    simultaneously by allowing callers to check this flag before starting.
 * 2. **Recovery marker** — if the server crashes mid-sync, the flag remains
 *    `'true'`, signalling that a recovery pass (via `resetSyncProgress`) may
 *    be needed on restart.
 *
 * Called at the very beginning of a sync cycle.
 */
export async function startSync(): Promise<void> {
  await prisma.settings.upsert({
    where:  { key: SYNC_IN_PROGRESS_KEY },
    update: { value: 'true' },
    create: { key: SYNC_IN_PROGRESS_KEY, value: 'true' },
  });
}

/**
 * Marks a sync operation as complete by clearing the in-progress flag and
 * persisting the total number of API requests made during the sync.
 *
 * This function performs two database writes:
 * 1. Clears the `sync_in_progress` flag (`'false'`), allowing new syncs to start.
 * 2. Stores the `totalRequests` count under `sync_total_requests`, which is
 *    later read by `getSyncProgress` to compute the progress percentage for
 *    subsequent syncs.
 *
 * @param totalRequests — The total number of API requests that were made
 *                        during this sync cycle.
 *
 * @throws If a database write fails (Prisma will throw).
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
