/**
 * Watchlist API — manage important ticket markers per user per board.
 *
 * Endpoints for adding, toggling, and listing watched issues.
 * All data is stored locally in SQLite — no Zoho API calls.
 */

import { Router } from 'express';
import prisma from '../../db/client';

const router = Router();

/**
 * GET /api/watchlist — List watched issues for a board/user.
 * @route GET /api/watchlist?boardId=<id>&userId=<id>
 * @method GET
 * @query boardId (optional) - Project zohoId to filter by
 * @query userId (optional) - User zohoId to filter by
 * @returns {Object} - { watchlist: WatchlistEntry[], total: number }
 * @auth Required (OAuth token validation)
 */
router.get('/', async (req, res) => {
  try {
    const { boardId, userId } = req.query;
    const where: Record<string, string> = {};
    if (boardId) where.boardId = String(boardId);
    if (userId) where.userId = String(userId);

    const watchlist = await prisma.watchlist.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { important: 'desc' },
    });

    // Fetch deadlines for all watchlist items to check if they have active deadlines
    const issueIds = watchlist.map(w => w.issueId);
    const deadlines = await prisma.deadline.findMany({
      where: { 
        issueId: { in: issueIds },
        ...(userId ? { userId: String(userId) } : {}),
      },
      select: { issueId: true },
    });
    const issuesWithDeadlines = new Set(deadlines.map(d => d.issueId));

    // Add hasDeadline flag to each watchlist entry
    const watchlistWithDeadlines = watchlist.map(w => ({
      ...w,
      hasDeadline: issuesWithDeadlines.has(w.issueId),
    }));

    res.json({ watchlist: watchlistWithDeadlines, total: watchlist.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Watchlist list failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/watchlist — Add issue to watchlist.
 * @route POST /api/watchlist
 * @method POST
 * @body {Object} body: { boardId: string; issueId: string; userId: string; important?: boolean }
 * @returns {Object} - Created watchlist entry
 * @notes
 *   - Upsert: if the same (boardId, issueId, userId) combo already exists, update in place
 *   - important defaults to true when added via POST
 * @auth Required (OAuth token validation)
 */
router.post('/', async (req, res) => {
  try {
    const { boardId, issueId, userId, important } = req.body as {
      boardId: string;
      issueId: string;
      userId: string;
      important?: boolean;
    };

    if (!boardId || !issueId || !userId) {
      res.status(400).json({ error: 'boardId, issueId, and userId are required' });
      return;
    }

    const entry = await prisma.watchlist.upsert({
      where: {
        boardId_issueId_userId: { boardId, issueId, userId },
      },
      update: { important: important ?? true },
      create: { boardId, issueId, userId, important: important ?? true },
    });
    res.json({ watchlist: entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Watchlist create failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * PATCH /api/watchlist/:issueId/toggle-important — Toggle importance flag.
 * @route PATCH /api/watchlist/:issueId/toggle-important
 * @method PATCH
 * @params {string} issueId - Issue zohoId
 * @body {Object} body: { boardId: string; userId: string }
 * @returns {Object} - Updated watchlist entry with toggled important flag
 * @auth Required (OAuth token validation)
 */
router.patch('/:issueId/toggle-important', async (req, res) => {
  try {
    const { issueId } = req.params;
    const { boardId, userId } = req.body as { boardId?: string; userId?: string };

    const where: Record<string, string> = { issueId };
    if (boardId) where.boardId = boardId;
    if (userId) where.userId = userId;

    const existing = await prisma.watchlist.findFirst({ where });
    if (!existing) {
      // If no watchlist entry exists, create one with important = true
      if (!boardId || !userId) {
        res.status(400).json({ error: 'boardId and userId are required when issue is not in watchlist' });
        return;
      }
      const entry = await prisma.watchlist.create({
        data: { boardId, issueId, userId, important: true },
      });
      res.json({ watchlist: entry });
      return;
    }

    if (existing.important) {
      // Check if this issue has a deadline before allowing removal
      const deadline = await prisma.deadline.findFirst({
        where: { issueId, userId: existing.userId },
      });
      if (deadline) {
        res.status(400).json({ 
          error: 'Cannot unwatch ticket with active deadline. To unwatch: 1) Go to Deadlines page 2) Find and remove the deadline for this ticket 3) Then unwatch it' 
        });
        return;
      }
      await prisma.watchlist.delete({ where: { id: existing.id } });
      res.json({ watchlist: { ...existing, important: false } });
      return;
    }

    const updated = await prisma.watchlist.update({
      where: { id: existing.id },
      data: { important: true },
    });
    res.json({ watchlist: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Watchlist toggle failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/watchlist/:issueId — Remove from watchlist.
 * @route DELETE /api/watchlist/:issueId
 * @method DELETE
 * @params {string} issueId - Issue zohoId
 * @body {Object} body: { boardId?: string; userId?: string }
 * @returns {Object} - { deleted: boolean }
 * @auth Required (OAuth token validation)
 */
router.delete('/:issueId', async (req, res) => {
  try {
    const { issueId } = req.params;
    const { boardId, userId } = req.body as { boardId?: string; userId?: string };

    const where: Record<string, string> = { issueId };
    if (boardId) where.boardId = boardId;
    if (userId) where.userId = userId;

    await prisma.watchlist.deleteMany({ where });
    res.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Watchlist delete failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
