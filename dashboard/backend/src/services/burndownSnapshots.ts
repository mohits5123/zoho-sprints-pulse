import prisma from '../db/client';

/** Record today's done/total snapshot for a sprint. Upserts — safe to call multiple times a day. */
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

export interface BurndownPoint {
  date:       string; // YYYY-MM-DD
  doneCount:  number;
  totalCount: number;
}

/** Return all snapshots for a sprint ordered by date ascending. */
export async function getBurndownSnapshots(sprintZohoId: string): Promise<BurndownPoint[]> {
  return prisma.burndownSnapshot.findMany({
    where:   { sprintZohoId },
    orderBy: { date: 'asc' },
    select:  { date: true, doneCount: true, totalCount: true },
  });
}
