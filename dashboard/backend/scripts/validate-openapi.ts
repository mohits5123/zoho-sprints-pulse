/**
 * OpenAPI contract validation.
 *
 * Validates the canonical OpenAPI 3.1 document and compares its operation
 * list with the live Express application. This catches both malformed
 * schemas and accidental endpoint drift before a change is merged.
 *
 * Run with: `npm run openapi:validate`
 */
import path from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import expressListEndpoints from 'express-list-endpoints';
import { createApp } from '../src/createApp';

const OPENAPI_PATH = path.resolve(__dirname, '..', 'openapi', 'openapi.yaml');

interface RouteInfo {
  method: string;
  path: string;
}

/**
 * Convert Express's `:param` syntax to OpenAPI's `{param}` syntax.
 */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/**
 * List routes exposed by the wired application.
 *
 * `express-list-endpoints` understands nested routers and normalizes
 * ordinary paths. Express represents the merge-params burndown mount as
 * a `RegExp(...)` path, so we replace that one known representation with
 * the public path declared in `src/api/router.ts`.
 */
function collectLiveRoutes(): RouteInfo[] {
  const app = createApp();
  const endpoints = expressListEndpoints(app) as Array<{
    path: string;
    methods: string[];
  }>;

  return endpoints.flatMap((endpoint) => {
    const normalizedPath = endpoint.path.includes('RegExp')
      ? '/api/sprints/:sprintZohoId/burndown'
      : endpoint.path.replace(/\/$/, '');

    return endpoint.methods.map((method) => ({
      method: method.toUpperCase(),
      path: normalizedPath,
    }));
  });
}

/**
 * Verify the spec and ensure every application operation is documented.
 */
async function main(): Promise<void> {
  // SwaggerParser validates the YAML syntax, OpenAPI version, and all
  // internal `$ref` pointers in one step.
  const api = (await SwaggerParser.validate(OPENAPI_PATH)) as {
    paths: Record<string, Record<string, unknown>>;
  };

  const liveRoutes = collectLiveRoutes();

  // Swagger UI serves its HTML/assets through middleware, so those two
  // paths are not returned by express-list-endpoints. Add only the public
  // JSON and HTML endpoints described in the contract.
  liveRoutes.push(
    { method: 'GET', path: '/api/openapi.json' },
    { method: 'GET', path: '/api/docs' },
  );

  const errors: string[] = [];

  // Every live route must have a matching documented operation.
  for (const { method, path: routePath } of liveRoutes) {
    const openApiPath = toOpenApiPath(routePath);
    if (!api.paths[openApiPath]?.[method.toLowerCase()]) {
      errors.push(`Missing OpenAPI operation for ${method} ${openApiPath}`);
    }
  }

  // Every documented operation must have a live route. This catches stale
  // entries left behind after an endpoint is renamed or removed.
  for (const [openApiPath, methods] of Object.entries(api.paths)) {
    for (const method of Object.keys(methods)) {
      if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;

      const expressPath = openApiPath.replace(/\{([^}]+)\}/g, ':$1');
      const found = liveRoutes.some(
        (route) => route.method === method.toUpperCase() && route.path === expressPath,
      );

      if (!found) {
        errors.push(`Spec declares ${method.toUpperCase()} ${openApiPath} but no live route exists`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('OpenAPI contract validation failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(`OpenAPI contract OK — ${liveRoutes.length} operations documented.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('OpenAPI validation crashed:', message);
  process.exit(1);
});
