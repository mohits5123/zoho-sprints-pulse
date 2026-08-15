/**
 * Tests for the documentation routes mounted by {@link createApp}.
 *
 * Asserts that:
 *  - `/api/openapi.json` returns a valid OpenAPI 3.1 document.
 *  - `/api/docs` renders Swagger UI HTML.
 *  - `/api/health` returns the expected probe.
 *
 * These run against the real `createApp()` with docs enabled.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/createApp';

describe('API documentation', () => {
  const app = createApp();

  it('GET /api/openapi.json returns the canonical document', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info?.title).toBe('Zonaliser API');
  });

  it('GET /api/docs renders the Swagger UI shell', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    // Swagger UI references its bundled assets by URL — at least one
    // such reference should be present in the rendered HTML.
    expect(res.text).toMatch(/swagger-ui/);
  });

  it('GET /api/health answers the liveness probe', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
