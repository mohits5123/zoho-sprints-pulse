/**
 * Health API - Service health check endpoint.
 * Returns current timestamp and basic health status for monitoring systems.
 */

import { Router } from 'express';

const router = Router();

/**
 * GET /api/health — Basic service health check.
 * @route GET /api/health
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { status: 'ok', timestamp: ISO-8601 datetime }
 * @auth Not required - public endpoint for health monitoring
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
