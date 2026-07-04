/**
 * Activity API — manage notifications and activity summary.
 *
 * Endpoints for fetching, marking as read, and clearing notifications
 * for watched ticket status changes. Also provides summary counts.
 * All data is stored locally in SQLite — no Zoho API calls.
 */

import { Router } from 'express';
import prisma from '../../db/client';

const router = Router();

/**
 * GET /api/activity/notifications — Fetch notifications for a user.
 * @route GET /api/activity/notifications?userId=<id>&read=<bool>
 * @method GET
 * @query userId (optional) - User zohoId to filter by
 * @query read (optional) - Filter by read status (true/false)
 * @returns {Object} - { notifications: ActivityNotification[], total: number }
 * @auth Required (OAuth token validation)
 */
router.get('/notifications', async (req, res) => {
  try {
    const { userId, read } = req.query;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = String(userId);
    if (read !== undefined) where.read = read === 'true';

    const notifications = await prisma.activityNotification.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ notifications, total: notifications.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notifications list failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * PATCH /api/activity/notifications/:id/read — Mark a notification as read.
 * @route PATCH /api/activity/notifications/:id/read
 * @method PATCH
 * @params {string} id - Notification UUID
 * @returns {Object} - Updated notification
 * @auth Required (OAuth token validation)
 */
router.patch('/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await prisma.activityNotification.update({
      where: { id },
      data: { read: true },
    });
    res.json({ notification });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notification mark read failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * DELETE /api/activity/notifications — Clear all read notifications.
 * @route DELETE /api/activity/notifications?userId=<id>
 * @method DELETE
 * @query userId (optional) - User zohoId to scope the deletion
 * @returns {Object} - { deleted: number }
 * @auth Required (OAuth token validation)
 */
router.delete('/notifications', async (req, res) => {
  try {
    const { userId } = req.query;
    const where: Record<string, unknown> = { read: true };
    if (userId) where.userId = String(userId);

    const result = await prisma.activityNotification.deleteMany({ where });
    res.json({ deleted: result.count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Notifications clear failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/activity/summary — Summary counts for activity section.
 * @route GET /api/activity/summary?userId=<id>
 * @method GET
 * @query userId (optional) - User zohoId to filter by
 * @returns {Object} - { unreadNotifications: number, upcomingDeadlines: number, importantIssues: number }
 * @auth Required (OAuth token validation)
 */
router.get('/summary', async (req, res) => {
  try {
    const { userId } = req.query;
    const userFilter = userId ? String(userId) : undefined;

    // Count unread notifications
    const unreadWhere: Record<string, unknown> = { read: false };
    if (userFilter) unreadWhere.userId = userFilter;
    const unreadNotifications = await prisma.activityNotification.count({ where: unreadWhere });

    // Count upcoming deadlines (within 24 hours, not completed)
    const now = new Date();
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const deadlinesWhere: Record<string, unknown> = {
      completed: false,
      dueDate: {
        gte: now,
        lte: future,
      },
    };
    if (userFilter) deadlinesWhere.userId = userFilter;
    const upcomingDeadlines = await prisma.deadline.count({ where: deadlinesWhere });

    // Count important issues (watchlist with important=true)
    const importantWhere: Record<string, unknown> = { important: true };
    if (userFilter) importantWhere.userId = userFilter;
    const importantIssues = await prisma.watchlist.count({ where: importantWhere });

    res.json({
      unreadNotifications,
      upcomingDeadlines,
      importantIssues,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Activity summary failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
