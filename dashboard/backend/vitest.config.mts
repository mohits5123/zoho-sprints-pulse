import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the Zonaliser backend.
 *
 * Tests run against the Express app produced by `createApp()` and use
 * supertest to make in-memory requests, so we don't need to bind a port
 * or touch the real SQLite database. The Prisma client is mocked
 * through `tests/__mocks__/db-client.ts` so tests can declare fixtures
 * without seeding `prisma/dev.db`.
 */
export default defineConfig({
  test: {
    // We use the Node environment because the app is server-only.
    environment: 'node',
    // Vitest's globals give us describe/it/expect without imports in
    // each file, matching the style already used elsewhere in the repo.
    globals: true,
    // Each test file gets its own Prisma mock by default; tests that
    // want shared fixtures can opt into a manual setup.
    include: ['tests/**/*.test.ts'],
    // Run tests sequentially so the mocked Prisma state isn't shared
    // across files in surprising ways.
    fileParallelism: false,
    // Tests should fail fast — a hung request usually means a missing
    // mock, not a real bug worth waiting for.
    testTimeout: 10_000,
  },
});
