import { Router } from 'express';
import axios from 'axios';
import prisma from '../../db/client';
import { fetchZohoUsers } from '../../services/zohoUsers';
import { queryUserIssues, queryUserSprintHistory } from '../../services/issueQueries';

const router = Router();

const VALID_ROLES = ['DEV', 'QA', 'PROD', 'OTHER'] as const;
type Role = (typeof VALID_ROLES)[number];

// GET /api/users — all locally stored users
router.get('/', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { name: 'asc' } });
    res.json({ users, total: users.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/users/:id/profile — cross-sprint issue summary for one developer
router.get('/:id/profile', async (req, res) => {
  try {
    const staleDays = Math.max(1, parseInt(String(req.query.staleDays ?? '7'), 10) || 7);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const activeSprints = await prisma.sprint.findMany({ where: { status: 'active' } });

    // Single DB query — no Zoho calls
    const allIssues = await queryUserIssues(user.zohoId, staleDays);
    const raisedIssues = allIssues.filter(i => i.creator?.id === user.zohoId);

    const todo    = allIssues.filter((i) => i.statusGroup === 'todo').length;
    const doing   = allIssues.filter((i) => i.statusGroup === 'doing').length;
    const done    = allIssues.filter((i) => i.statusGroup === 'done').length;
    const stale   = allIssues.filter((i) => i.isStale).length;
    const overdue = allIssues.filter((i) => i.delayedDays > 0 && i.statusGroup !== 'done').length;
    const collab  = allIssues.filter((i) => i.assignees.length > 1).length;

    res.json({
      user: { id: user.id, zohoId: user.zohoId, name: user.name, email: user.email, role: user.role },
      issues:       allIssues,
      raisedIssues,
      summary:      { total: allIssues.length, todo, doing, done, stale, overdue, collab, raised: raisedIssues.length },
      sprintCount:  activeSprints.length,
      staleDays,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ user profile failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /api/users/:id/sprint-history — per-sprint stats for one developer
router.get('/:id/sprint-history', async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? '12'), 10) || 12));
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Single DB query — no Zoho calls
    const history = await queryUserSprintHistory(user.zohoId, limit);
    res.json({ history, total: history.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ sprint-history failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// POST /api/users/sync — pull from Zoho and upsert locally
router.post('/sync', async (_req, res) => {
  try {
    const zohoUsers = await fetchZohoUsers();

    if (zohoUsers.length === 0) {
      res.status(502).json({
        error: 'Zoho returned 0 users. The authenticated account may not have admin access (ZohoSprints.teamusers.READ scope required).',
      });
      return;
    }

    const upserted = await Promise.all(
      zohoUsers.map((u) =>
        prisma.user.upsert({
          where: { zohoId: u.zohoId },
          update: { name: u.name, email: u.email },
          create: { zohoId: u.zohoId, name: u.name, email: u.email, role: 'OTHER' },
        })
      )
    );

    res.json({ synced: upserted.length, users: upserted });
  } catch (err) {
    const zohoBody = axios.isAxiosError(err) ? err.response?.data : undefined;
    const message  = axios.isAxiosError(err)
      ? `Zoho API ${err.response?.status ?? 'error'} at ${err.config?.url}: ${JSON.stringify(zohoBody ?? err.message)}`
      : (err instanceof Error ? err.message : 'Unknown error');
    console.error('❌ Sync failed:', message);
    res.status(500).json({ error: message });
  }
});

// PATCH /api/users/:id/role — update the local role label
router.patch('/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body as { role: string };
    if (!VALID_ROLES.includes(role as Role)) {
      res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}` });
      return;
    }
    const user = await prisma.user.update({ where: { id }, data: { role } });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
