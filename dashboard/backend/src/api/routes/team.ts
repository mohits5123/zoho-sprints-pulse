import { Router } from 'express';
import { queryTeamLoad } from '../../services/issueQueries';

const router = Router();

// GET /api/team/load — aggregate WIP + stale counts across ALL active sprints per user
router.get('/load', async (req, res) => {
  try {
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const { users, sprintCount, projectCount } = await queryTeamLoad(staleDays);
    res.json({ users, sprintCount, projectCount, staleDays });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ team/load failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
