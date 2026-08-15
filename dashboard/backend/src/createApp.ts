/**
 * Express application factory.
 *
 * Centralises the wiring of middleware, API routes, and the optional
 * Swagger UI / OpenAPI document routes. The production entry-point
 * (`src/index.ts`) calls `createApp()` and then `app.listen(...)` plus
 * cron registration; tests call `createApp()` to obtain an app
 * instance without touching the network or the scheduler.
 *
 * Keeping the factory separate from bootstrap means:
 *   - Tests never need a real port, real Zoho auth, or a real cron.
 *   - The OpenAPI document and Swagger UI can be turned off in tests
 *     by setting `enableDocs: false`, or replaced with a stub spec.
 *   - We can run multiple app instances side-by-side (e.g. one per test).
 */
import express, { type Express } from 'express';
import cors from 'cors';
import apiRouter from './api/router';
import { createDocsRouter, loadOpenApiDocument } from './api/docs';

/**
 * Options accepted by {@link createApp}.
 */
export interface CreateAppOptions {
  /**
   * When `true` (default), mount `/api/openapi.json` and `/api/docs`
   * (Swagger UI). Tests typically leave this enabled so they can assert
   * the docs route renders.
   */
  enableDocs?: boolean;
  /**
   * Override the loaded OpenAPI document. Useful for tests that want
   * to assert against a mutated copy (e.g. adding example responses).
   */
  openApiDocument?: unknown;
}

/**
 * Build a fully-wired Express application. The caller owns the returned
 * object and is responsible for listening, closing, or passing it to
 * supertest.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const { enableDocs = true, openApiDocument } = options;

  const app = express();

  // Dev frontend is the only CORS origin we accept. The Vite proxy
  // already hides the backend port in production, so this is a safety
  // belt rather than a strict requirement.
  app.use(cors({ origin: 'http://localhost:5173' }));

  // Parse JSON bodies globally — every route expects JSON.
  app.use(express.json());

  // Document and UI routes are mounted under /api alongside the rest
  // of the API so the Vite proxy handles them transparently.
  if (enableDocs) {
    const spec = (openApiDocument ?? loadOpenApiDocument()) as Record<string, unknown>;
    app.use('/api', createDocsRouter(spec));
  }

  // Mount all functional API routes under /api. Order matters: the
  // docs router is mounted first so `/api/docs` and `/api/openapi.json`
  // are always reachable, even if a future route shadowed them.
  app.use('/api', apiRouter);

  return app;
}
