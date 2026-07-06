/**
 * Notes API — manage notes with @mentions and linked issues.
 *
 * Endpoints for CRUD operations on notes, plus search helpers
 * for user mentions and issue linking.
 * All data is stored locally in SQLite — no Zoho API calls.
 */

import { Router } from 'express';
import prisma from '../../db/client';

const router = Router();

/**
 * GET /api/notes — List all notes for a user.
 * @route GET /api/notes?userId=<id>
 * @method GET
 * @query userId (optional) - User zohoId to filter by
 * @returns {Object} - { notes: Note[], total: number }
 * @auth Required (OAuth token validation)
 */
router.get('/', async (req, res) => {
  try {
    const { userId } = req.query;
    const where: Record<string, string> = {};
    if (userId) where.userId = String(userId);

    const notes = await prisma.note.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ notes, total: notes.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notes list failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/notes — Create a new note.
 * @route POST /api/notes
 * @method POST
 * @body {Object} body: { userId: string; title?: string; content?: string; issueIds?: string[]; taggedUserIds?: string[] }
 * @returns {Object} - Created note
 * @auth Required (OAuth token validation)
 */
router.post('/', async (req, res) => {
  try {
    const { userId, title, content, issueIds, taggedUserIds } = req.body as {
      userId: string;
      title?: string;
      content?: string;
      issueIds?: string[];
      taggedUserIds?: string[];
    };

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const note = await prisma.note.create({
      data: {
        userId,
        title: title ?? 'Untitled',
        content: content ?? '',
        issueIds: JSON.stringify(issueIds ?? []),
        taggedUserIds: JSON.stringify(taggedUserIds ?? []),
      },
    });
    res.json({ note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note create failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * PATCH /api/notes/:noteId — Update a note.
 * @route PATCH /api/notes/:noteId
 * @method PATCH
 * @params {string} noteId - Note UUID
 * @body {Object} body: { title?: string; content?: string; issueIds?: string[]; taggedUserIds?: string[] }
 * @returns {Object} - Updated note
 * @auth Required (OAuth token validation)
 */
router.patch('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { title, content, issueIds, taggedUserIds } = req.body as {
      title?: string;
      content?: string;
      issueIds?: string[];
      taggedUserIds?: string[];
    };

    const data: Record<string, string> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (issueIds !== undefined) data.issueIds = JSON.stringify(issueIds);
    if (taggedUserIds !== undefined) data.taggedUserIds = JSON.stringify(taggedUserIds);

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const note = await prisma.note.update({ where: { id: noteId }, data });
    res.json({ note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note update failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/notes/:noteId — Delete a note.
 * @route DELETE /api/notes/:noteId
 * @method DELETE
 * @params {string} noteId - Note UUID
 * @returns {Object} - { deleted: boolean }
 * @auth Required (OAuth token validation)
 */
router.delete('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    await prisma.note.delete({ where: { id: noteId } });
    res.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note delete failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/notes/search-users — Search users by name for @mentions.
 * @route GET /api/notes/search-users?q=<query>
 * @method GET
 * @query q - Search query (partial name match, case-insensitive)
 * @returns {Object} - { users: Array<{ id: string; name: string }> }
 * @auth Required (OAuth token validation)
 */
router.get('/search-users', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: { name: { contains: q } },
      select: { zohoId: true, name: true },
      take: 20,
      orderBy: { name: 'asc' },
    });

    const result = users.map(u => ({ id: u.zohoId, name: u.name }));
    res.json({ users: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('User search failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/notes/search-issues — Search issues by title for linking.
 * @route GET /api/notes/search-issues?q=<query>&boardId=<id>
 * @method GET
 * @query q - Search query (partial title match, case-insensitive)
 * @query boardId (optional) - Project zohoId to scope the search
 * @returns {Object} - { issues: Array<{ zohoId: string; itemNo: string; title: string }> }
 * @auth Required (OAuth token validation)
 */
router.get('/search-issues', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const boardId = req.query.boardId ? String(req.query.boardId) : undefined;

    if (!q) {
      res.json({ issues: [] });
      return;
    }

    const where: Record<string, unknown> = {
      title: { contains: q },
    };
    if (boardId) where.projectZohoId = boardId;

    const issues = await prisma.issue.findMany({
      where,
      select: { zohoId: true, itemNo: true, title: true },
      take: 20,
      orderBy: { itemNo: 'asc' },
    });

    res.json({ issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Issue search failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
