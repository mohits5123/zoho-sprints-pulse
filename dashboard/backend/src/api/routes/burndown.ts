import { Router, Request } from 'express';
import { getBurndownSnapshots, recordBurndownSnapshot, type BurndownPoint } from '../../services/burndownSnapshots';

const router = Router({ mergeParams: true });

// GET /api/sprints/:sprintZohoId/burndown?doneCount=N&totalCount=N
// Seeds today's snapshot using caller-supplied counts (from live epics) if not yet recorded.
router.get('/', async (req: Request<{ sprintZohoId: string }>, res) => {
  const { sprintZohoId } = req.params;
  const seedDone  = req.query['doneCount']  != null ? Number(req.query['doneCount'])  : null;
  const seedTotal = req.query['totalCount'] != null ? Number(req.query['totalCount']) : null;

  try {
    let snapshots: BurndownPoint[] = await getBurndownSnapshots(sprintZohoId);

    const today = new Date().toISOString().slice(0, 10);

    // Seed or correct today's snapshot using live counts from the caller.
    // Always upsert when seed values are provided so stale DB entries get fixed.
    if (seedDone !== null && seedTotal !== null && seedTotal > 0) {
      await recordBurndownSnapshot(sprintZohoId, seedDone, seedTotal);
      const todayEntry = { date: today, doneCount: seedDone, totalCount: seedTotal };
      snapshots = [
        ...snapshots.filter((s) => s.date !== today),
        todayEntry,
      ].sort((a, b) => a.date.localeCompare(b.date));
    }

    res.json({ snapshots });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load burndown data' });
  }
});

export default router;
