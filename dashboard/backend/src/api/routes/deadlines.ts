/**
 * Deadlines API — manage local reminders and deadlines for watched issues.
 *
 * Endpoints for CRUD operations on deadlines, plus upcoming deadline queries.
 * All data is stored locally in SQLite — no Zoho API calls.
 */

import { Router } from 'express';
import prisma from '../../db/client';

const router = Router();

/**
 * GET /api/deadlines — List deadlines, optionally filtered by user and/or board.
 * @route GET /api/deadlines?userId=<id>&boardId=<id>
 * @method GET
 * @query userId (optional) - User zohoId to filter by
 * @query boardId (optional) - Project zohoId to filter by
 * @returns {Object} - { deadlines: Deadline[], total: number }
 * @auth Required (OAuth token validation)
 */
router.get('/', async (req, res) => {
  try {
    const { userId, boardId } = req.query;
    const where: Record<string, string> = {};
    if (userId) where.userId = String(userId);
    if (boardId) where.boardId = String(boardId);

    const deadlines = await prisma.deadline.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { dueDate: 'asc' },
    });
    res.json({ deadlines, total: deadlines.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadlines list failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/deadlines — Create a new deadline.
 * @route POST /api/deadlines
 * @method POST
 * @body {Object} body: { userId: string; title: string; dueDate: string; boardId?: string; issueId?: string; completed?: boolean }
 * @returns {Object} - Created deadline
 * @auth Required (OAuth token validation)
 */
router.post('/', async (req, res) => {
  try {
    const { userId, title, dueDate, boardId, issueId, completed } = req.body as {
      userId: string;
      title: string;
      dueDate: string;
      boardId?: string;
      issueId?: string;
      completed?: boolean;
    };

    if (!userId || !title || !dueDate) {
      res.status(400).json({ error: 'userId, title, and dueDate are required' });
      return;
    }

    const deadline = await prisma.deadline.create({
      data: {
        userId,
        title,
        dueDate: new Date(dueDate),
        boardId: boardId ?? null,
        issueId: issueId ?? null,
        completed: completed ?? false,
      },
    });
    res.json({ deadline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadline create failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * PATCH /api/deadlines/:deadlineId — Update a deadline.
 * @route PATCH /api/deadlines/:deadlineId
 * @method PATCH
 * @params {string} deadlineId - Deadline UUID
 * @body {Object} body: { title?: string; dueDate?: string; boardId?: string; issueId?: string; completed?: boolean }
 * @returns {Object} - Updated deadline
 * @auth Required (OAuth token validation)
 */
router.patch('/:deadlineId', async (req, res) => {
  try {
    const { deadlineId } = req.params;
    const { title, dueDate, boardId, issueId, completed } = req.body as {
      title?: string;
      dueDate?: string;
      boardId?: string | null;
      issueId?: string | null;
      completed?: boolean;
    };

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (dueDate !== undefined) data.dueDate = new Date(dueDate);
    if (boardId !== undefined) data.boardId = boardId;
    if (issueId !== undefined) data.issueId = issueId;
    if (completed !== undefined) data.completed = completed;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const deadline = await prisma.deadline.update({ where: { id: deadlineId }, data });
    res.json({ deadline });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadline update failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/deadlines/:deadlineId — Delete a deadline.
 * @route DELETE /api/deadlines/:deadlineId
 * @method DELETE
 * @params {string} deadlineId - Deadline UUID
 * @returns {Object} - { deleted: boolean }
 * @auth Required (OAuth token validation)
 */
router.delete('/:deadlineId', async (req, res) => {
  try {
    const { deadlineId } = req.params;
    await prisma.deadline.delete({ where: { id: deadlineId } });
    res.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadline delete failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/deadlines/upcoming — Fetch deadlines within N hours from now.
 * @route GET /api/deadlines/upcoming?userId=<id>&hours=<n>
 * @method GET
 * @query userId (optional) - User zohoId to filter by
 * @query hours (optional, default: 24) - Number of hours ahead to check
 * @returns {Object} - { deadlines: Deadline[], total: number }
 * @notes
 *   - Only returns active (not completed) deadlines
 *   - Returns deadlines where dueDate is between now and now + hours
 * @auth Required (OAuth token validation)
 */
router.get('/combined', async (req, res) => {
  try {
    const { userId } = req.query;
    const now = new Date();

    const deadlineWhere: Record<string, unknown> = {};
    if (userId) deadlineWhere.userId = String(userId);

    const noteWhere: Record<string, unknown> = {
      deadline: { not: null },
      state: 'active',
    };
    if (userId) noteWhere.userId = String(userId);

    const [deadlines, notes] = await Promise.all([
      prisma.deadline.findMany({
        where: Object.keys(deadlineWhere).length > 0 ? deadlineWhere : undefined,
        orderBy: { dueDate: 'asc' },
      }),
      prisma.note.findMany({
        where: noteWhere,
        orderBy: { deadline: 'asc' },
      }),
    ]);

    const combined = [
      ...deadlines.map(d => ({
        id: d.id,
        source: 'deadline' as const,
        deadlineId: d.id,
        title: d.title,
        dueDate: d.dueDate.toISOString(),
        completed: d.completed,
        isOverdue: !d.completed && new Date(d.dueDate) < now,
      })),
      ...notes.map(n => ({
        id: n.id,
        source: 'note' as const,
        noteId: n.id,
        title: n.title,
        dueDate: n.deadline!.toISOString(),
        completed: false,
        isOverdue: new Date(n.deadline!) < now,
      })),
    ].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

    res.json({ deadlines: combined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Combined deadlines failed:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/upcoming', async (req, res) => {
  try {
    const { userId, hours } = req.query;
    const hoursNum = parseInt(String(hours ?? '24'), 10) || 24;

    const now = new Date();
    const future = new Date(now.getTime() + hoursNum * 60 * 60 * 1000);

    const where: Record<string, unknown> = {
      completed: false,
      dueDate: {
        gte: now,
        lte: future,
      },
    };
    if (userId) where.userId = String(userId);

    const deadlines = await prisma.deadline.findMany({
      where,
      orderBy: { dueDate: 'asc' },
    });
    res.json({ deadlines, total: deadlines.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Upcoming deadlines failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
