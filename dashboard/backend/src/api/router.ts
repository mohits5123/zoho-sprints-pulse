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

router.use('/health', healthRouter);
router.use('/status', statusRouter);
router.use('/users', usersRouter);
router.use('/projects', projectsRouter);
router.use('/sprints', sprintsRouter);
router.use('/config', appConfigRouter);
router.use('/sync/status', syncStatusRouter);
router.use('/sprints/:sprintZohoId/burndown', burndownRouter);
router.use('/team', teamRouter);

export default router;
