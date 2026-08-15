/**
 * Representative tests for projects, watchlist, deadlines, and activity.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { seed, resetMockPrisma } from './__mocks__/db-client';
import { createApp } from '../src/createApp';

vi.mock('../src/db/client', async () => {
  const mock = await import('./__mocks__/db-client');
  return { default: mock.buildMockPrisma() };
});

const app = createApp();

describe('projects routes', () => {
  beforeEach(() => resetMockPrisma());

  it('GET /api/projects returns activeSprints and total', async () => {
    seed('project', {
      zohoId: 'p1',
      name: 'Demo',
      status: 'active',
      boardType: 'scrum',
      displayOrder: 0,
      hidden: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.projects[0].zohoId).toBe('p1');
    expect(Array.isArray(res.body.projects[0].activeSprints)).toBe(true);
  });

  it('GET /api/projects/:id returns 404 for unknown project', async () => {
    const res = await request(app).get('/api/projects/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Project not found');
  });
});

describe('watchlist routes', () => {
  beforeEach(() => resetMockPrisma());

  it('POST /api/watchlist upserts an entry and returns the row', async () => {
    const res = await request(app).post('/api/watchlist').send({
      boardId: 'p1',
      issueId: 'i1',
      userId: 'u1',
    });
    expect(res.status).toBe(200);
    expect(res.body.watchlist.important).toBe(true);
  });

  it('POST /api/watchlist requires boardId, issueId, userId', async () => {
    const res = await request(app).post('/api/watchlist').send({ boardId: 'p1' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/watchlist/:issueId returns { deleted: true }', async () => {
    seed('watchlist', {
      id: 'w1',
      boardId: 'p1',
      issueId: 'i1',
      userId: 'u1',
      important: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app).delete('/api/watchlist/i1').send({ boardId: 'p1', userId: 'u1' });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

describe('deadlines routes', () => {
  beforeEach(() => resetMockPrisma());

  it('POST /api/deadlines creates a reminder with all required fields', async () => {
    const res = await request(app).post('/api/deadlines').send({
      userId: 'u1',
      title: 'Ship v1',
      dueDate: new Date('2030-01-01').toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.deadline.title).toBe('Ship v1');
    expect(res.body.deadline.completed).toBe(false);
  });

  it('POST /api/deadlines rejects requests missing required fields', async () => {
    const res = await request(app).post('/api/deadlines').send({ userId: 'u1' });
    expect(res.status).toBe(400);
  });
});

describe('activity routes', () => {
  beforeEach(() => resetMockPrisma());

  it('GET /api/activity/summary returns counts even when DB is empty', async () => {
    const res = await request(app).get('/api/activity/summary');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      unreadNotifications: expect.any(Number),
      upcomingDeadlines: expect.any(Number),
      importantIssues: expect.any(Number),
    });
  });
});
