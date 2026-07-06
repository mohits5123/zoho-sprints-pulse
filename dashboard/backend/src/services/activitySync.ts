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
import { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

/**
 * Settings key for storing the previous status snapshot of watched issues.
 * Value is a JSON string: { "issueZohoId": "oldStatus", ... }
 */
const WATCHED_STATUSES_KEY = 'watched_statuses_snapshot';

/**
 * Parse the previous status snapshot from Settings.
 * Returns an empty object if not found or invalid.
 */
async function getPreviousStatuses(tx?: TransactionClient): Promise<Record<string, string>> {
  const client = tx ?? prisma;
  const row = await client.settings.findUnique({ where: { key: WATCHED_STATUSES_KEY } });
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
async function savePreviousStatuses(snapshot: Record<string, string>, tx?: TransactionClient): Promise<void> {
  const client = tx ?? prisma;
  await client.settings.upsert({
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
  return prisma.$transaction(async (tx) => {
    const watchlist = await tx.watchlist.findMany();
    if (watchlist.length === 0) return 0;

    const previousStatuses = await getPreviousStatuses(tx);

    const watchedIssueIds = [...new Set(watchlist.map(w => w.issueId))];
    const currentIssues = await tx.issue.findMany({
      where: { zohoId: { in: watchedIssueIds } },
      select: { zohoId: true, status: true, projectZohoId: true },
    });

    const currentStatusMap = new Map(currentIssues.map(i => [i.zohoId, { status: i.status, boardId: i.projectZohoId }]));

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

      newSnapshot[entry.issueId] = newStatus;

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

    if (notifications.length > 0) {
      await tx.activityNotification.createMany({
        data: notifications,
      });
    }

    await savePreviousStatuses(newSnapshot, tx);

    return notifications.length;
  });
}

/**
 * Check for note deadline notifications and create alerts.
 *
 * This function should be called after each sync completes. It:
 * 1. Fetches all notes with deadlines that are active
 * 2. For each note, checks if deadline is within 24 hours or today
 * 3. Creates ActivityNotification records for upcoming/overdue deadlines
 * 4. Updates the deadlineNotified flag to prevent duplicate notifications
 *
 * @returns Number of notifications created
 */
export async function checkNoteDeadlineNotifications(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const notesWithDeadlines = await tx.note.findMany({
      where: {
        deadline: { not: null },
        state: 'active',
      },
    });

    if (notesWithDeadlines.length === 0) return 0;

    const notifications: Array<{
      userId: string;
      type: string;
      issueId: string;
      boardId: string;
      noteId: string;
      oldStatus: string;
      newStatus: string;
    }> = [];

    for (const note of notesWithDeadlines) {
      if (!note.deadline) continue;

      const deadline = new Date(note.deadline);

      if (deadline >= now && deadline <= tomorrow && !note.deadlineNotified) {
        const issueIds = JSON.parse(note.issueIds || '[]') as string[];
        notifications.push({
          userId: note.userId,
          type: 'deadline_reminder',
          issueId: issueIds[0] || '',
          boardId: '',
          noteId: note.id,
          oldStatus: 'deadline_reminder',
          newStatus: note.state,
        });

        await tx.note.update({
          where: { id: note.id },
          data: { deadlineNotified: true },
        });
      }

      if (deadline >= startOfToday && deadline < endOfToday) {
        const existingDayOf = await tx.activityNotification.findFirst({
          where: {
            userId: note.userId,
            noteId: note.id,
            type: 'deadline_day_of',
          },
        });

        if (!existingDayOf) {
          const issueIds = JSON.parse(note.issueIds || '[]') as string[];
          notifications.push({
            userId: note.userId,
            type: 'deadline_day_of',
            issueId: issueIds[0] || '',
            boardId: '',
            noteId: note.id,
            oldStatus: 'deadline_day_of',
            newStatus: note.state,
          });
        }
      }
    }

    if (notifications.length > 0) {
      await tx.activityNotification.createMany({
        data: notifications,
      });
    }

    return notifications.length;
  });
}

/**
 * Initialize the watched statuses snapshot with current statuses.
 *
 * This should be called once on first sync or when the snapshot is missing.
 * It populates the snapshot without creating notifications.
 */
export async function initializeWatchedStatusesSnapshot(): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const watchlist = await tx.watchlist.findMany();
    if (watchlist.length === 0) return;

    const watchedIssueIds = [...new Set(watchlist.map(w => w.issueId))];
    const currentIssues = await tx.issue.findMany({
      where: { zohoId: { in: watchedIssueIds } },
      select: { zohoId: true, status: true },
    });

    const snapshot: Record<string, string> = {};
    for (const issue of currentIssues) {
      snapshot[issue.zohoId] = issue.status;
    }

    await savePreviousStatuses(snapshot, tx);
  });
}
