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
 * Extract project number from raw Zoho data.
 * 
 * Zoho's API returns project data in a denormalized format:
 * - `prop` is a mapping of field names to their indices in the `fields` array
 *   (e.g., `{ projName: 0, owner: 5, projNo: 3 }`)
 * - `fields` is an array of actual field values at those indices
 * 
 * So `prop.projNo` gives us the INDEX where the project number is stored,
 * not the project number itself. We then look up `fields[prop.projNo]` to get
 * the actual project number value.
 * 
 * @param rawData - JSON string containing { fields: unknown[], prop: Record<string, number> }
 * @returns Project number as string, or null if not found
 */
function extractProjNo(rawData: string | null): string | null {
  try {
    if (!rawData) return null;
    const rd = JSON.parse(rawData) as { fields?: unknown[]; prop?: Record<string, number> };
    // prop.projNo is the INDEX into fields array, not the value itself
    const projNoIndex = rd.prop?.projNo ?? 1;
    const projNoValue = rd.fields?.[projNoIndex];
    return projNoValue != null ? String(projNoValue) : null;
  } catch { return null; }
}

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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
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

    const [deadlineGroups, deadlines, notes] = await Promise.all([
      prisma.deadlineGroup.findMany({
        orderBy: { dueDate: 'asc' },
      }),
      prisma.deadline.findMany({
        where: Object.keys(deadlineWhere).length > 0 ? deadlineWhere : undefined,
        orderBy: { dueDate: 'asc' },
      }),
      prisma.note.findMany({
        where: noteWhere,
        orderBy: { deadline: 'asc' },
      }),
    ]);

    // Collect all issue IDs, board IDs, and user IDs to fetch details
    const issueIds = new Set<string>();
    const boardIds = new Set<string>();
    const userIds = new Set<string>();
    for (const d of deadlines) {
      if (d.issueId) issueIds.add(d.issueId);
      if (d.boardId) boardIds.add(d.boardId);
    }

    // Fetch issue details and project projNo in parallel
    const [issues, projects] = await Promise.all([
      issueIds.size > 0
        ? prisma.issue.findMany({
            where: { zohoId: { in: Array.from(issueIds) } },
            select: {
              zohoId: true,
              itemNo: true,
              title: true,
              status: true,
              statusGroup: true,
              assigneeIds: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      boardIds.size > 0
        ? prisma.project.findMany({
            where: { zohoId: { in: Array.from(boardIds) } },
            select: { zohoId: true, rawData: true },
          })
        : Promise.resolve([]),
    ]);

    // Collect all assignee IDs from issues
    for (const issue of issues) {
      try {
        const assignees = JSON.parse(issue.assigneeIds || '[]') as string[];
        assignees.forEach(id => userIds.add(id));
      } catch { /* ignore parse errors */ }
    }

    // Fetch user details for assignees
    const users = userIds.size > 0
      ? await prisma.user.findMany({
          where: { zohoId: { in: Array.from(userIds) } },
          select: { zohoId: true, name: true, role: true },
        })
      : [];

    // Extract projNo from rawData for each project
    const projectMap = new Map(projects.map(p => [p.zohoId, extractProjNo(p.rawData)]));
    const issueMap = new Map(issues.map(i => [i.zohoId, i]));
    const userMap = new Map(users.map(u => [u.zohoId, u]));

    type SubItem = {
      id: string;
      source: 'note' | 'deadline';
      noteId?: string;
      deadlineId?: string;
      boardId?: string | null;
      issueId?: string | null;
      title: string;
      // Issue details (for ticket sub-items)
      itemNo?: string;
      status?: string;
      statusGroup?: string;
      assignees?: Array<{ id: string; name: string; role: string }>;
      createdAt?: string | null;
      projNo?: string;
    };

    type DeadlineGroup = {
      id: string;
      title: string;
      dueDate: string;
      isOverdue: boolean;
      subItems: SubItem[];
    };

    const groupMap = new Map<string, DeadlineGroup>();

    for (const group of deadlineGroups) {
      groupMap.set(group.id, {
        id: group.id,
        title: group.title,
        dueDate: group.dueDate.toISOString(),
        isOverdue: group.dueDate < now,
        subItems: [],
      });
    }

    for (const d of deadlines) {
      const issue = d.issueId ? issueMap.get(d.issueId) : null;
      const projNo = d.boardId ? projectMap.get(d.boardId) : undefined;

      // Parse assignee IDs and map to user details
      let assignees: Array<{ id: string; name: string; role: string }> = [];
      if (issue) {
        try {
          const assigneeIds = JSON.parse(issue.assigneeIds || '[]') as string[];
          assignees = assigneeIds
            .map(id => {
              const user = userMap.get(id);
              return user ? { id: user.zohoId, name: user.name, role: user.role } : null;
            })
            .filter((u): u is { id: string; name: string; role: string } => u !== null);
        } catch { /* ignore parse errors */ }
      }

      const subItem: SubItem = {
        id: d.id,
        source: 'deadline' as const,
        deadlineId: d.id,
        boardId: d.boardId,
        issueId: d.issueId,
        title: issue?.title || d.title,
        // Include issue details if available
        ...(issue && {
          itemNo: issue.itemNo,
          status: issue.status,
          statusGroup: issue.statusGroup,
          assignees,
          createdAt: issue.createdAt,
        }),
        ...(projNo && { projNo }),
      };

      if (d.deadlineGroupId && groupMap.has(d.deadlineGroupId)) {
        groupMap.get(d.deadlineGroupId)!.subItems.push(subItem);
      } else {
        const standaloneGroup: DeadlineGroup = {
          id: `standalone-deadline-${d.id}`,
          title: d.title,
          dueDate: d.dueDate.toISOString(),
          isOverdue: !d.completed && d.dueDate < now,
          subItems: [subItem],
        };
        groupMap.set(standaloneGroup.id, standaloneGroup);
      }
    }

    for (const n of notes) {
      const subItem: SubItem = {
        id: n.id,
        source: 'note' as const,
        noteId: n.id,
        title: n.title,
      };

      if (n.deadlineGroupId && groupMap.has(n.deadlineGroupId)) {
        groupMap.get(n.deadlineGroupId)!.subItems.push(subItem);
      } else {
        const standaloneGroup: DeadlineGroup = {
          id: `standalone-note-${n.id}`,
          title: n.title,
          dueDate: n.deadline!.toISOString(),
          isOverdue: n.deadline! < now,
          subItems: [subItem],
        };
        groupMap.set(standaloneGroup.id, standaloneGroup);
      }
    }

    const combined = Array.from(groupMap.values()).sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );

    res.json({ deadlines: combined });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Combined deadlines failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/deadlines/available-watchlist — Watchlist entries not already linked to a deadline.
 * @route GET /api/deadlines/available-watchlist
 * @method GET
 * @query excludeGroupId (optional) - DeadlineGroup UUID whose items should still appear as available (for editing)
 * @returns {Object} - { items: { boardId, issueId, issueTitle, issueItemNo }[] }
 */
router.get('/available-watchlist', async (req, res) => {
  try {
    const { excludeGroupId } = req.query;
    const [watchlist, deadlines] = await Promise.all([
      prisma.watchlist.findMany({ where: { userId: 'local' } }),
      prisma.deadline.findMany({
        where: {
          issueId: { not: null },
          ...(excludeGroupId ? { deadlineGroupId: { not: String(excludeGroupId) } } : {}),
        },
        select: { issueId: true },
      }),
    ]);

    const deadlineIssueIds = new Set(deadlines.map(d => d.issueId!));
    const available = watchlist.filter(w => !deadlineIssueIds.has(w.issueId));

    if (available.length === 0) {
      res.json({ items: [] });
      return;
    }

    const issueIds = available.map(w => w.issueId);
    const issues = await prisma.issue.findMany({
      where: { zohoId: { in: issueIds } },
      select: { zohoId: true, itemNo: true, title: true },
    });
    const issueMap = new Map(issues.map(i => [i.zohoId, i]));

    const items = available.map(w => {
      const issue = issueMap.get(w.issueId);
      return {
        boardId: w.boardId,
        issueId: w.issueId,
        issueTitle: issue?.title ?? 'Unknown',
        issueItemNo: issue?.itemNo ?? '',
      };
    });

    res.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Available watchlist fetch failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/deadlines/batch — Create a deadline group for notes and/or watchlist entries.
 * @route POST /api/deadlines/batch
 * @method POST
 * @body {Object} body: {
 *   dueDate: string,
 *   title: string,                — title for the deadline group
 *   noteIds?: string[],           — active note IDs to set the deadline on
 *   watchlistItems?: { boardId: string; issueId: string }[],  — watchlist entries to create Deadline records for
 *   userId?: string,              — user for the group (defaults to 'local')
 * }
 * @returns {Object} - { groupId: string, updatedNotes: number, createdDeadlines: number }
 */
router.post('/batch', async (req, res) => {
  try {
    const { dueDate, title, noteIds, watchlistItems, userId } = req.body as {
      dueDate: string;
      title: string;
      noteIds?: string[];
      watchlistItems?: { boardId: string; issueId: string }[];
      userId?: string;
    };

    if (!dueDate || !title) {
      res.status(400).json({ error: 'dueDate and title are required' });
      return;
    }

    const parsedDate = new Date(dueDate);
    if (isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: 'Invalid dueDate' });
      return;
    }

    const hasNotes = noteIds && noteIds.length > 0;
    const hasWatchlist = watchlistItems && watchlistItems.length > 0;

    if (!hasNotes && !hasWatchlist) {
      res.status(400).json({ error: 'At least one note or watchlist item is required' });
      return;
    }

    const effectiveUserId = userId ?? 'local';

    const { group, updatedNotes, createdDeadlines } = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.deadlineGroup.create({
        data: {
          title,
          dueDate: parsedDate,
          userId: effectiveUserId,
        },
      });

      let noteCount = 0;
      if (hasNotes) {
        const result = await tx.note.updateMany({
          where: { id: { in: noteIds! }, state: 'active' },
          data: { deadline: parsedDate, deadlineGroupId: newGroup.id },
        });
        noteCount = result.count;
      }

      let deadlineCount = 0;
      if (hasWatchlist) {
        const result = await tx.deadline.createMany({
          data: watchlistItems!.map(item => ({
            userId: effectiveUserId,
            title,
            dueDate: parsedDate,
            boardId: item.boardId,
            issueId: item.issueId,
            deadlineGroupId: newGroup.id,
          })),
        });
        deadlineCount = result.count;
      }

      return { group: newGroup, updatedNotes: noteCount, createdDeadlines: deadlineCount };
    });

    res.json({ groupId: group.id, updatedNotes, createdDeadlines });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Batch deadline create failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/deadlines/groups/:groupId — Update a deadline group and its sub-items.
 * @route PATCH /api/deadlines/groups/:groupId
 * @method PATCH
 * @params {string} groupId - DeadlineGroup UUID
 * @body {Object} body: {
 *   title?: string,
 *   dueDate?: string,
 *   noteIds?: string[],
 *   watchlistItems?: { boardId: string; issueId: string }[],
 *   userId?: string,
 * }
 * @returns {Object} - { groupId: string, updatedNotes: number, addedDeadlines: number, removedDeadlines: number }
 */
router.patch('/groups/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { title, dueDate, noteIds, watchlistItems, userId } = req.body as {
      title?: string;
      dueDate?: string;
      noteIds?: string[];
      watchlistItems?: { boardId: string; issueId: string }[];
      userId?: string;
    };

    const group = await prisma.deadlineGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      res.status(404).json({ error: 'Deadline group not found' });
      return;
    }

    const parsedDate = dueDate ? new Date(dueDate) : group.dueDate;
    if (dueDate && isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: 'Invalid dueDate' });
      return;
    }

    const effectiveUserId = userId ?? group.userId;

    const result = await prisma.$transaction(async (tx) => {
      // Update the group itself
      await tx.deadlineGroup.update({
        where: { id: groupId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(dueDate !== undefined ? { dueDate: parsedDate } : {}),
        },
      });

      let updatedNotes = 0;
      let addedDeadlines = 0;
      let removedDeadlines = 0;

      // Handle notes: compare current vs desired
      if (noteIds !== undefined) {
        const currentNotes = await tx.note.findMany({
          where: { deadlineGroupId: groupId },
          select: { id: true },
        });
        const currentNoteIds = new Set(currentNotes.map(n => n.id));
        const desiredNoteIds = new Set(noteIds);

        // Remove notes no longer in the group
        const notesToRemove = Array.from(currentNoteIds).filter(id => !desiredNoteIds.has(id));
        if (notesToRemove.length > 0) {
          const res = await tx.note.updateMany({
            where: { id: { in: notesToRemove } },
            data: { deadline: null, deadlineGroupId: null },
          });
          removedDeadlines += res.count;
        }

        // Add notes newly added to the group
        const notesToAdd = noteIds.filter(id => !currentNoteIds.has(id));
        const addedNoteIds = new Set<string>();
        if (notesToAdd.length > 0) {
          const res = await tx.note.updateMany({
            where: { id: { in: notesToAdd }, state: 'active' },
            data: { deadline: parsedDate, deadlineGroupId: groupId },
          });
          updatedNotes += res.count;
          notesToAdd.forEach(id => addedNoteIds.add(id));
        }

        // Update dueDate on notes that remain in the group (if date changed)
        // Exclude newly added notes to avoid double-counting
        if (dueDate !== undefined) {
          const notesToUpdate = noteIds.filter(id => currentNoteIds.has(id) && !addedNoteIds.has(id));
          if (notesToUpdate.length > 0) {
            const res = await tx.note.updateMany({
              where: { id: { in: notesToUpdate } },
              data: { deadline: parsedDate },
            });
            updatedNotes += res.count;
          }
        }
      }

      // Handle watchlist items: compare current vs desired
      if (watchlistItems !== undefined) {
        const currentDeadlines = await tx.deadline.findMany({
          where: { deadlineGroupId: groupId, issueId: { not: null } },
          select: { id: true, boardId: true, issueId: true },
        });
        const currentKeys = new Set(
          currentDeadlines.map(d => `${d.boardId}|${d.issueId}`),
        );
        const desiredKeys = new Set(
          watchlistItems.map(w => `${w.boardId}|${w.issueId}`),
        );

        // Remove deadlines no longer in the group
        const toRemove = currentDeadlines.filter(d => !desiredKeys.has(`${d.boardId}|${d.issueId}`));
        if (toRemove.length > 0) {
          await tx.deadline.deleteMany({
            where: { id: { in: toRemove.map(d => d.id) } },
          });
          removedDeadlines += toRemove.length;
        }

        // Add new watchlist items in bulk
        const itemsToAdd = watchlistItems.filter(item => !currentKeys.has(`${item.boardId}|${item.issueId}`));
        if (itemsToAdd.length > 0) {
          await tx.deadline.createMany({
            data: itemsToAdd.map(item => ({
              userId: effectiveUserId,
              title: title ?? group.title,
              dueDate: parsedDate,
              boardId: item.boardId,
              issueId: item.issueId,
              deadlineGroupId: groupId,
            })),
          });
          addedDeadlines += itemsToAdd.length;
        }

        // Update dueDate and title on existing deadlines (if changed)
        if (dueDate !== undefined || title !== undefined) {
          const existingKeys = new Set(
            watchlistItems
              .map(w => `${w.boardId}|${w.issueId}`)
              .filter(k => currentKeys.has(k)),
          );
          if (existingKeys.size > 0) {
            const existingDeadlines = currentDeadlines.filter(
              d => existingKeys.has(`${d.boardId}|${d.issueId}`),
            );
            if (existingDeadlines.length > 0) {
              await tx.deadline.updateMany({
                where: { id: { in: existingDeadlines.map(d => d.id) } },
                data: {
                  ...(dueDate !== undefined ? { dueDate: parsedDate } : {}),
                  ...(title !== undefined ? { title } : {}),
                },
              });
            }
          }
        }
      }

      return { updatedNotes, addedDeadlines, removedDeadlines };
    });

    res.json({ groupId: group.id, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadline group update failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/deadlines/groups/:groupId — Delete a deadline group and clear associated deadlines.
 * @route DELETE /api/deadlines/groups/:groupId
 * @method DELETE
 * @params {string} groupId - DeadlineGroup UUID (or synthetic ID like 'standalone-deadline-xxx' or 'standalone-note-xxx')
 * @returns {Object} - { deleted: boolean, clearedNotes: number, deletedDeadlines: number }
 */
router.delete('/groups/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;

    // Handle synthetic IDs for standalone deadlines/notes
    if (groupId.startsWith('standalone-deadline-')) {
      const deadlineId = groupId.replace('standalone-deadline-', '');
      if (!deadlineId) {
        res.status(400).json({ error: 'Invalid standalone deadline ID' });
        return;
      }
      try {
        await prisma.deadline.delete({ where: { id: deadlineId } });
        res.json({ deleted: true, clearedNotes: 0, deletedDeadlines: 1 });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
          res.status(404).json({ error: 'Standalone deadline not found' });
        } else {
          throw err;
        }
      }
      return;
    }

    if (groupId.startsWith('standalone-note-')) {
      const noteId = groupId.replace('standalone-note-', '');
      if (!noteId) {
        res.status(400).json({ error: 'Invalid standalone note ID' });
        return;
      }
      try {
        await prisma.note.update({
          where: { id: noteId },
          data: { deadline: null, deadlineGroupId: null },
        });
        res.json({ deleted: true, clearedNotes: 1, deletedDeadlines: 0 });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2025') {
          res.status(404).json({ error: 'Standalone note not found' });
        } else {
          throw err;
        }
      }
      return;
    }

    // Handle real deadline groups
    const group = await prisma.deadlineGroup.findUnique({ where: { id: groupId } });
    if (!group) {
      res.status(404).json({ error: 'Deadline group not found' });
      return;
    }

    const [notesResult, deadlinesResult] = await Promise.all([
      prisma.note.updateMany({
        where: { deadlineGroupId: groupId },
        data: { deadline: null, deadlineGroupId: null },
      }),
      prisma.deadline.deleteMany({
        where: { deadlineGroupId: groupId },
      }),
    ]);

    await prisma.deadlineGroup.delete({ where: { id: groupId } });

    res.json({
      deleted: true,
      clearedNotes: notesResult.count,
      deletedDeadlines: deadlinesResult.count,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deadline group delete failed:', msg);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
