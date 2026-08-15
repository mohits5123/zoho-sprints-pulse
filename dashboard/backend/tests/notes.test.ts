/**
 * Regression tests for the notes route group.
 *
 * Covers the historical route-order bug where `/api/notes/:noteId` was
 * registered before static paths and would capture `search-users`,
 * `search-issues`, and `with-deadlines` as note IDs. Each test below
 * would have failed against the pre-fix version of the router.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { resetMockPrisma, seed } from './__mocks__/db-client';
import { createApp } from '../src/createApp';

// `vi.mock` is hoisted by vitest. The async factory loads the TypeScript
// mock through Vite's module graph instead of Node's CommonJS `require`,
// which cannot resolve this source-only test helper reliably.
vi.mock('../src/db/client', async () => {
  const mock = await import('./__mocks__/db-client');
  return { default: mock.buildMockPrisma() };
});

const app = createApp();

describe('notes routes', () => {
  beforeEach(() => {
    resetMockPrisma();
  });

  it('GET /api/notes/with-deadlines is not captured by /:noteId', async () => {
    seed('note', {
      id: 'note-1',
      userId: 'u1',
      title: 'Has deadline',
      content: '',
      issueIds: '[]',
      taggedUserIds: '[]',
      state: 'active',
      deadline: new Date('2030-01-01').toISOString(),
      deadlineGroupId: null,
      deadlineNotified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/notes/with-deadlines');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.notes)).toBe(true);
    expect(res.body.notes[0].id).toBe('note-1');
    expect(typeof res.body.notes[0].isOverdue).toBe('boolean');
  });

  it('GET /api/notes/search-users returns user matches, not 404', async () => {
    seed('user', { zohoId: 'u1', name: 'Ada Lovelace', email: null, role: 'DEV' });

    const res = await request(app).get('/api/notes/search-users').query({ q: 'Ada' });
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([{ id: 'u1', name: 'Ada Lovelace' }]);
  });

  it('GET /api/notes/search-issues returns issue matches, not 404', async () => {
    seed('issue', {
      zohoId: 'i1',
      itemNo: 'P-1',
      title: 'Login broken',
      status: 'open',
      sprintZohoId: 's1',
      projectZohoId: 'p1',
      assigneeIds: '[]',
      deletedAt: null,
    });

    const res = await request(app).get('/api/notes/search-issues').query({ q: 'Login' });
    expect(res.status).toBe(200);
    expect(res.body.issues).toEqual([
      { zohoId: 'i1', itemNo: 'P-1', title: 'Login broken' },
    ]);
  });

  it('GET /api/notes/:noteId still works for a real UUID', async () => {
    seed('note', {
      id: '11111111-1111-1111-1111-111111111111',
      userId: 'u1',
      title: 'Real note',
      content: 'hello',
      issueIds: '[]',
      taggedUserIds: '[]',
      state: 'active',
      deadline: null,
      deadlineGroupId: null,
      deadlineNotified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await request(app).get('/api/notes/11111111-1111-1111-1111-111111111111');
    expect(res.status).toBe(200);
    expect(res.body.note.title).toBe('Real note');
  });

  it('GET /api/notes/:noteId returns 404 for unknown IDs', async () => {
    const res = await request(app).get('/api/notes/22222222-2222-2222-2222-222222222222');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Note not found');
  });
});
