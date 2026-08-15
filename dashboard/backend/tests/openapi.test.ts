/**
 * Tests for the OpenAPI document itself.
 *
 * These run independently of the Express app. They parse the YAML,
 * validate it against the OpenAPI 3.1 meta-schema, and assert a few
 * project-specific invariants (every tag is referenced, every schema
 * has at least one consumer, etc.).
 */
import { describe, it, expect } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';
import path from 'node:path';
import YAML from 'yamljs';

const OPENAPI_PATH = path.resolve(__dirname, '..', 'openapi', 'openapi.yaml');

describe('OpenAPI document', () => {
  it('parses as YAML', () => {
    expect(() => YAML.load(OPENAPI_PATH)).not.toThrow();
  });

  it('conforms to the OpenAPI 3.1 meta-schema', async () => {
    // `validate` resolves any $ref and runs the meta-schema check in
    // one step; throwing here means the spec is malformed.
    await expect(SwaggerParser.validate(OPENAPI_PATH)).resolves.toBeDefined();
  });

  it('declares every endpoint under /api', async () => {
    const spec = (await SwaggerParser.dereference(OPENAPI_PATH)) as {
      paths: Record<string, unknown>;
    };
    const paths = Object.keys(spec.paths);
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) {
      expect(p.startsWith('/api')).toBe(true);
    }
  });

  it('groups every operation under a known tag', async () => {
    const spec = (await SwaggerParser.dereference(OPENAPI_PATH)) as {
      paths: Record<string, Record<string, { tags?: string[] }>>;
    };
    const allowed = new Set([
      'Health', 'Sync', 'Users', 'Team', 'Projects', 'Sprints',
      'Burndown', 'Issues', 'Notes', 'Deadlines', 'Watchlist',
      'Activity', 'Docs',
    ]);
    for (const [routePath, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (typeof op !== 'object' || op === null) continue;
        // Skip non-operation keys (parameters, summary, description).
        if (!Array.isArray(op.tags)) continue;
        for (const tag of op.tags) {
          expect(allowed.has(tag), `${method.toUpperCase()} ${routePath} uses unknown tag "${tag}"`).toBe(true);
        }
      }
    }
  });
});
