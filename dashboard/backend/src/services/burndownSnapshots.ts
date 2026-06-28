import prisma from '../db/client';

/**
 * Record a burndown snapshot for a sprint, capturing the number of completed
 * issues (done) against the total issue count at a specific point in time.
 *
 * This function performs an upsert — if a snapshot already exists for the given
 * sprint on today's date, it will be overwritten with the new values. This makes
 * the function safe to call multiple times per day (e.g., from repeated cron jobs
 * or polling mechanisms). Only one entry per sprint per date is maintained.
 *
 * Snapshots are the raw data source for sprint burndown charts, enabling teams
 * to visualize progress toward sprint completion over time.
 *
 * @param sprintZohoId  The unique identifier of the sprint in Zoho Sprints.
 * @param doneCount     The number of issues marked as done/completed at the time of recording.
 * @param totalCount    The total number of issues in the sprint at the time of recording.
 *
 * @returns A promise that resolves once the snapshot has been persisted.
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

/**
 * Represents a single data point in a sprint burndown timeline.
 *
 * Each point captures the state of a sprint at a specific date, recording how
 * many issues have been completed (done) out of the total issues scoped to the
 * sprint. When plotted over time, these points form a burndown chart that
 * visualizes whether a sprint is on track to complete all committed work.
 *
 * @property date   The date this snapshot was recorded, in `YYYY-MM-DD` format.
 * @property doneCount   The number of completed issues on this date.
 * @property totalCount  The total number of issues in the sprint on this date.
 */
export interface BurndownPoint {
  date:       string; // YYYY-MM-DD format
  doneCount:  number; // Number of completed issues on this date
  totalCount: number; // Total issues in sprint on this date
}

/**
 * Retrieve all burndown snapshots for a given sprint, ordered chronologically.
 *
 * Fetches every recorded data point for the sprint and returns them sorted by
 * date in ascending order — earliest snapshot first. This ordering is essential
 * for correctly rendering a burndown chart, where the x-axis represents the
 * timeline of the sprint and the y-axis shows remaining work.
 *
 * If no snapshots exist for the sprint (e.g., the sprint has not yet been
 * recorded or the sprint identifier is invalid), an empty array is returned.
 *
 * @param sprintZohoId  The unique identifier of the sprint in Zoho Sprints.
 *
 * @returns A promise resolving to an array of `BurndownPoint` objects ordered by date ascending.
 *          Returns an empty array if no snapshots exist for the given sprint.
 */
export async function getBurndownSnapshots(sprintZohoId: string): Promise<BurndownPoint[]> {
  return prisma.burndownSnapshot.findMany({
    where:   { sprintZohoId },
    orderBy: { date: 'asc' },
    select:  { date: true, doneCount: true, totalCount: true },
  });
}
