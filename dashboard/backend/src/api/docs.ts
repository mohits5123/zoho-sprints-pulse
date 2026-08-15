/**
 * API documentation module.
 *
 * Exposes two routes that together make the API self-describing:
 *
 *   - `GET /api/openapi.json` — the raw OpenAPI 3.1 document, parsed
 *     once at boot from `openapi/openapi.yaml` and served as JSON.
 *   - `GET /api/docs`         — Swagger UI bound to that document.
 *
 * The router is intentionally minimal: it does not touch the database
 * or call Zoho, so mounting it in production adds zero runtime cost
 * beyond serving a static-ish document.
 */
import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';

/**
 * Resolve the canonical OpenAPI document path. We always read the file
 * from disk on first call so that local edits during development are
 * picked up without restarting the process.
 */
// `__dirname` is `src/api` during development and `dist/api` after the
// TypeScript build. In both cases the canonical spec lives two levels up
// in the backend package's `openapi/` directory.
export const OPENAPI_PATH = path.resolve(__dirname, '..', '..', 'openapi', 'openapi.yaml');

/**
 * Parse and return the OpenAPI document. The file is small and parsing
 * is cheap, so we re-read on each call. Tests that need a mutated copy
 * can bypass this by passing their own `document` to
 * {@link createDocsRouter}.
 */
export function loadOpenApiDocument(): Record<string, unknown> {
  return YAML.load(OPENAPI_PATH) as Record<string, unknown>;
}

/**
 * Build a router that serves `/openapi.json` and `/docs` for the given
 * document. The router is mounted under `/api` from {@link createApp}.
 *
 * @param document  Parsed OpenAPI 3.1 document. Defaults to the file on
 *                  disk so production code can simply call this with
 *                  no arguments.
 */
export function createDocsRouter(document: Record<string, unknown> = loadOpenApiDocument()): Router {
  const router = Router();

  /**
   * `GET /openapi.json` — returns the parsed spec. We deliberately
   * keep the response small by handing Express the object directly;
   * `res.json` will serialise with default JSON behaviour.
   */
  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });

  /**
   * `GET /docs` — Swagger UI. We use `swaggerUi.serve` and
   * `swaggerUi.setup` rather than the combined helper so we can keep
   * the router interface consistent with the rest of the codebase.
   */
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(document, {
    // Make "Try it out" the default — local-only deployment means the
    // risk of an accidental mutation is acceptable, and it improves
    // discoverability while debugging.
    swaggerOptions: { tryItOutEnabled: true },
    // Suppress the default Swagger UI title — the OpenAPI `info.title`
    // already covers it.
    customSiteTitle: 'Zonaliser API',
  }));

  return router;
}
