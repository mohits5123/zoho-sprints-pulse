/**
 * Representative contract tests for the user routes.
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

describe('users routes', () => {
  beforeEach(() => {
    resetMockPrisma();
  });

  it('GET /api/users returns the user roster', async () => {
    seed('user', { zohoId: 'u1', name: 'Alice', email: 'a@x', role: 'DEV' });
    seed('user', { zohoId: 'u2', name: 'Bob', email: 'b@x', role: 'QA' });

    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.users.map((u: { zohoId: string }) => u.zohoId)).toEqual(['u1', 'u2']);
  });

  it('PATCH /api/users/:id/role rejects unknown roles with 400', async () => {
    seed('user', { zohoId: 'u1', name: 'Alice', email: 'a@x', role: 'DEV' });

    const res = await request(app)
      .patch('/api/users/u1/role')
      .send({ role: 'WIZARD' });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('PATCH /api/users/:id/role accepts the documented enum', async () => {
    seed('user', { zohoId: 'u1', name: 'Alice', email: 'a@x', role: 'DEV' });

    const res = await request(app)
      .patch('/api/users/u1/role')
      .send({ role: 'QA' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('QA');
  });
});
