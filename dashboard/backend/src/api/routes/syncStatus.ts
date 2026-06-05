import { Router } from 'express';
import { getLastSyncedAt } from '../../services/syncStatus';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const lastSyncedAt = await getLastSyncedAt();
    res.json({ lastSyncedAt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read sync status' });
  }
});

export default router;
