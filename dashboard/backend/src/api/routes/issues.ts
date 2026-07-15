/**
 * Issues API - Single issue fetch endpoints.
 *
 * Endpoints for fetching individual issues by their Zoho ID.
 * All data is read from local SQLite — no Zoho API calls.
 */

import { Router } from 'express';
import prisma from '../../db/client';
import { queryIssueById } from '../../services/issueQueries';

const router = Router();

/**
 * GET /api/issues/deleted — Fetch all soft-deleted issues.
 * @route GET /api/issues/deleted
 * @method GET
 * @returns {Object} - { issues: Array }
 */
router.get('/deleted', async (_req, res) => {
  try {
    const issues = await prisma.issue.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      select: {
        zohoId: true,
        itemNo: true,
        title: true,
        status: true,
        sprintZohoId: true,
        projectZohoId: true,
        deletedAt: true,
        missingSyncCount: true,
      },
    });
    res.json({ issues });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Deleted issues fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/issues/:issueId — Fetch a single issue by its Zoho ID.
 * @route GET /api/issues/:issueId
 * @method GET
 * @param {string} issueId - Issue's zohoId (primary key)
 * @returns {Object} - { issue: IssueItem | null }
 * @auth Required (OAuth token validation)
 */
router.get('/:issueId', async (req, res) => {
  try {
    const { issueId } = req.params;
    const issue = await queryIssueById(issueId);
    if (!issue) {
      res.status(404).json({ error: 'Issue not found' });
      return;
    }
    res.json({ issue });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Issue fetch failed:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
