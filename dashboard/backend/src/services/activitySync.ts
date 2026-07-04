/**
 * Activity Sync Service — post-sync notification logic for watched tickets.
 *
 * After each sync completes, this service checks if any watched issues have
 * changed status. If so, it creates ActivityNotification records for the
 * affected users.
 *
 * Architecture:
 * 1. Fetch all Watchlist entries (watched issues)
 * 2. For each watched issue, fetch current status from Issue table
 * 3. Compare against previous status snapshot (stored in Settings as JSON)
 * 4. If status differs, create ActivityNotification record
 * 5. Update the previous status snapshot
 *
 * All data is stored locally in SQLite — no Zoho API calls.
 */

import prisma from '../db/client';

/**
 * Settings key for storing the previous status snapshot of watched issues.
 * Value is a JSON string: { "issueZohoId": "oldStatus", ... }
 */
const WATCHED_STATUSES_KEY = 'watched_statuses_snapshot';

/**
 * Parse the previous status snapshot from Settings.
 * Returns an empty object if not found or invalid.
 */
async function getPreviousStatuses(): Promise<Record<string, string>> {
  const row = await prisma.settings.findUnique({ where: { key: WATCHED_STATUSES_KEY } });
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Save the current status snapshot to Settings.
 */
async function savePreviousStatuses(snapshot: Record<string, string>): Promise<void> {
  await prisma.settings.upsert({
    where: { key: WATCHED_STATUSES_KEY },
    update: { value: JSON.stringify(snapshot) },
    create: { key: WATCHED_STATUSES_KEY, value: JSON.stringify(snapshot) },
  });
}

/**
 * Check for status changes in watched issues and create notifications.
 *
 * This function should be called after each sync completes. It:
 * 1. Fetches all Watchlist entries
 * 2. Fetches current status for each watched issue
 * 3. Compares against previous snapshot
 * 4. Creates ActivityNotification records for changed statuses
 * 5. Updates the snapshot
 *
 * @returns Number of notifications created
 */
export async function checkWatchedIssueStatusChanges(): Promise<number> {
  // Fetch all watchlist entries
  const watchlist = await prisma.watchlist.findMany();
  if (watchlist.length === 0) return 0;

  // Get previous status snapshot
  const previousStatuses = await getPreviousStatuses();

  // Build current status map for watched issues
  const watchedIssueIds = [...new Set(watchlist.map(w => w.issueId))];
  const currentIssues = await prisma.issue.findMany({
    where: { zohoId: { in: watchedIssueIds } },
    select: { zohoId: true, status: true, projectZohoId: true },
  });

  const currentStatusMap = new Map(currentIssues.map(i => [i.zohoId, { status: i.status, boardId: i.projectZohoId }]));

  // Compare and create notifications
  const notifications: Array<{
    userId: string;
    issueId: string;
    boardId: string;
    oldStatus: string;
    newStatus: string;
  }> = [];

  const newSnapshot: Record<string, string> = {};

  for (const entry of watchlist) {
    const current = currentStatusMap.get(entry.issueId);
    if (!current) continue;

    const oldStatus = previousStatuses[entry.issueId];
    const newStatus = current.status;

    // Store current status in new snapshot
    newSnapshot[entry.issueId] = newStatus;

    // If status changed and we had a previous status, create notification
    if (oldStatus && oldStatus !== newStatus) {
      notifications.push({
        userId: entry.userId,
        issueId: entry.issueId,
        boardId: current.boardId,
        oldStatus,
        newStatus,
      });
    }
  }

  // Create notifications in bulk
  if (notifications.length > 0) {
    await prisma.activityNotification.createMany({
      data: notifications,
    });
  }

  // Save new snapshot
  await savePreviousStatuses(newSnapshot);

  return notifications.length;
}

/**
 * Initialize the watched statuses snapshot with current statuses.
 *
 * This should be called once on first sync or when the snapshot is missing.
 * It populates the snapshot without creating notifications.
 */
export async function initializeWatchedStatusesSnapshot(): Promise<void> {
  const watchlist = await prisma.watchlist.findMany();
  if (watchlist.length === 0) return;

  const watchedIssueIds = [...new Set(watchlist.map(w => w.issueId))];
  const currentIssues = await prisma.issue.findMany({
    where: { zohoId: { in: watchedIssueIds } },
    select: { zohoId: true, status: true },
  });

  const snapshot: Record<string, string> = {};
  for (const issue of currentIssues) {
    snapshot[issue.zohoId] = issue.status;
  }

  await savePreviousStatuses(snapshot);
}
