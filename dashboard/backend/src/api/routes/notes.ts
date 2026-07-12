import { Router } from 'express';
import prisma from '../../db/client';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { userId, state } = req.query;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = String(userId);
    if (state) where.state = String(state);

    const notes = await prisma.note.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ notes, total: notes.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notes list failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { userId, title, content, issueIds, taggedUserIds, state, deadline } = req.body as {
      userId: string;
      title?: string;
      content?: string;
      issueIds?: string[];
      taggedUserIds?: string[];
      state?: string;
      deadline?: string | null;
    };

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    if (state !== undefined && state !== 'active' && state !== 'closed') {
      res.status(400).json({ error: 'state must be "active" or "closed"' });
      return;
    }

    let parsedDeadline: Date | null = null;
    if (deadline) {
      parsedDeadline = new Date(deadline);
      if (isNaN(parsedDeadline.getTime())) {
        res.status(400).json({ error: 'Invalid deadline date' });
        return;
      }
    }

    const note = await prisma.note.create({
      data: {
        userId,
        title: title ?? 'Untitled',
        content: content ?? '',
        issueIds: JSON.stringify(issueIds ?? []),
        taggedUserIds: JSON.stringify(taggedUserIds ?? []),
        state: state ?? 'active',
        deadline: parsedDeadline,
      },
    });
    res.json({ note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note create failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    res.json({ note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note fetch failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    const { title, content, issueIds, taggedUserIds, state, deadline, deadlineNotified } = req.body as {
      title?: string;
      content?: string;
      issueIds?: string[];
      taggedUserIds?: string[];
      state?: string;
      deadline?: string | null;
      deadlineNotified?: boolean;
    };

    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (issueIds !== undefined) data.issueIds = JSON.stringify(issueIds);
    if (taggedUserIds !== undefined) data.taggedUserIds = JSON.stringify(taggedUserIds);
    if (state !== undefined) {
      if (state !== 'active' && state !== 'closed') {
        res.status(400).json({ error: 'state must be "active" or "closed"' });
        return;
      }
      data.state = state;
    }
    if (deadline !== undefined) {
      if (deadline) {
        const parsedDeadline = new Date(deadline);
        if (isNaN(parsedDeadline.getTime())) {
          res.status(400).json({ error: 'Invalid deadline date' });
          return;
        }
        data.deadline = parsedDeadline;
      } else {
        data.deadline = null;
      }
    }
    if (deadlineNotified !== undefined) data.deadlineNotified = deadlineNotified;

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    const note = await prisma.note.update({ where: { id: noteId }, data });
    res.json({ note });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note update failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:noteId', async (req, res) => {
  try {
    const { noteId } = req.params;
    // Check if the note has a deadline before allowing deletion
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (note?.deadline) {
      res.status(400).json({ 
        error: 'Cannot delete note with active deadline. To delete this note: 1) Click "Edit" 2) Clear the deadline field 3) Save the note 4) Then delete it' 
      });
      return;
    }
    await prisma.note.delete({ where: { id: noteId } });
    res.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Note delete failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/with-deadlines', async (req, res) => {
  try {
    const { userId } = req.query;
    const where: Record<string, unknown> = {
      deadline: { not: null },
    };
    if (userId) where.userId = String(userId);

    const notes = await prisma.note.findMany({
      where,
      orderBy: { deadline: 'asc' },
    });

    const now = new Date();
    const result = notes.map(note => ({
      ...note,
      isOverdue: note.deadline !== null && new Date(note.deadline) < now && note.state === 'active',
    }));

    res.json({ notes: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notes with deadlines failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      deletedAt: null,
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
