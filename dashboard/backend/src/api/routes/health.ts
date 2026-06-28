/**
 * Health API - Service health check endpoint.
 * Returns current timestamp and basic health status for monitoring systems.
 *
 * This module registers a single GET route (`/api/health`) that external
 * monitoring tools (e.g., Kubernetes liveness probes, uptime monitors) can
 * call to verify the service is alive and responsive. No authentication or
 * request body is required.
 */

import { Router } from 'express';

const router = Router();

/**
 * GET /api/health — Basic service health check.
 *
 * Responds immediately with a 200 status, an `"ok"` health indicator, and the
 * current UTC timestamp. Intended for periodic checks by load balancers,
 * container orchestrators, and uptime-monitoring services.
 *
 * @route GET /api/health
 * @method GET
 * @headers Content-Type: application/json
 * @returns {Object} - { status: 'ok', timestamp: ISO-8601 datetime }
 * @auth Not required - public endpoint for health monitoring
 */
router.get('/', (_req, res) => {
  // Return a minimal, constant-shape response so monitoring tools can
  // reliably parse it without needing schema validation.
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
