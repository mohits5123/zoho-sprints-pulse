/**
 * API Router - Express middleware for mounting route modules under /api.
 *
 * This router serves all dashboard API endpoints. Routes are mounted with
 * path prefixes and automatically proxy to their respective route handlers.
 * All routes use the rate limiter (Zoho API) and read from SQLite database.
 */

import { Router } from 'express';
import healthRouter from './routes/health';
import statusRouter from './routes/status';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import sprintsRouter from './routes/sprints';
import appConfigRouter from './routes/appConfig';
import syncStatusRouter from './routes/syncStatus';
import burndownRouter from './routes/burndown';
import teamRouter from './routes/team';

const router = Router();

/**
 * Mount health check endpoint at /api/health
 */
router.use('/health', healthRouter);

/**
 * Mount status endpoint at /api/status - checks Zoho API connectivity and OAuth token expiry
 */
router.use('/status', statusRouter);

/**
 * Mount user endpoints at /api/users - manage users and fetch per-user metrics
 */
router.use('/users', usersRouter);

/**
 * Mount project endpoints at /api/projects - fetch projects, sync project list, manage board settings
 */
router.use('/projects', projectsRouter);

/**
 * Mount sprint endpoints at /api/sprints - fetch sprints, sync sprints (fire-and-forget)
 */
router.use('/sprints', sprintsRouter);

/**
 * Mount app config endpoint at /api/config - frontend configuration values (workspace name)
 */
router.use('/config', appConfigRouter);

/**
 * Mount sync status endpoint at /api/sync - returns last successful sync timestamp and progress
 */
router.use('/sync', syncStatusRouter);

/**
 * Mount burndown endpoint at /api/sprints/:sprintZohoId/burndown - fetch or seed burndown data
 */
router.use('/sprints/:sprintZohoId/burndown', burndownRouter);

/**
 * Mount team endpoints at /api/team - fetch aggregate team load metrics across all sprints
 */
router.use('/team', teamRouter);

export default router;
