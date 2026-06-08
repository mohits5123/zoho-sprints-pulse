import prisma from '../db/client';

/**
 * Record today's done/total snapshot for a sprint.
 * 
 * Upserts the snapshot — safe to call multiple times per day, will update
 * existing entries or create new ones. Used for tracking sprint burndown progress.
 */
export async function recordBurndownSnapshot(
  sprintZohoId: string,
  doneCount: number,
  totalCount: number,
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  await prisma.burndownSnapshot.upsert({
    where:  { sprintZohoId_date: { sprintZohoId, date } },
    update: { doneCount, totalCount },
    create: { sprintZohoId, date, doneCount, totalCount },
  });
}

/** Burndown data point: cumulative completed work on a specific date. */
export interface BurndownPoint {
  date:       string; // YYYY-MM-DD format
  doneCount:  number; // Number of completed issues on this date
  totalCount: number; // Total issues in sprint on this date
}

/**
 * Return all burndown snapshots for a sprint ordered by date ascending.
 * Used for generating burndown charts in dashboard.
 */
export async function getBurndownSnapshots(sprintZohoId: string): Promise<BurndownPoint[]> {
  return prisma.burndownSnapshot.findMany({
    where:   { sprintZohoId },
    orderBy: { date: 'asc' },
    select:  { date: true, doneCount: true, totalCount: true },
  });
}
