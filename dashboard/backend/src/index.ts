import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config';
import { initAuth } from './services/zohoAuth';
import { runFullSync } from './services/zohoSprints';
import apiRouter from './api/router';

/**
 * Entry point for the Zonaliser backend API server.
 *
 * Bootstraps an Express application that serves as the backend for the Zonaliser dashboard.
 * It handles authentication with Zoho services, exposes RESTful API routes under `/api`,
 * and runs a background cron job that synchronizes data from Zoho Sprints every hour.
 *
 * The server respects a configurable port (via `config.port`) and is designed to work
 * alongside a frontend dev server running at `http://localhost:5173`.
 *
 * Startup sequence:
 * 1. Initialize Zoho OAuth credentials via `initAuth()`.
 * 2. Configure middleware: CORS for the dev frontend, JSON body parsing.
 * 3. Mount the API router at `/api`.
 * 4. Start the HTTP listener.
 * 5. Register a hourly cron job (`0 * * * *`) that triggers a full data sync.
 */

/**
 * Executes a full data synchronization with Zoho Sprints.
 *
 * Fetches and updates the latest projects, sprints, issues, and change logs
 * from Zoho Sprints, then persists the result and updates the last-sync timestamp
 * in the database.
 *
 * This function is safe to call repeatedly — it is idempotent and includes
 * built-in rate limiting to respect Zoho's API quota (≤25 requests/min).
 *
 * Errors are logged but never re-thrown, so the cron job will not crash the
 * process on transient sync failures.
 */
async function executeFullSync(): Promise<void> {
  try {
    console.log('⏱  Full sync starting…');
    await runFullSync();
    console.log('✅ Full sync complete');
  } catch (err) {
    console.error('⚠️  Full sync failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Bootstraps the Express server and starts the application.
 *
 * Initializes authentication, configures middleware, mounts API routes,
 * and begins listening for HTTP requests on the configured port.
 *
 * Once the server is listening, a cron job is registered to trigger
 * `executeFullSync()` every hour at the top of each hour (`0 * * * *`).
 * The sync routine itself enforces rate limiting to stay within Zoho's
 * API request quota.
 *
 * If initialization fails at any point, the error is logged and the
 * process exits with a non-zero status code.
 */
async function bootstrap(): Promise<void> {
  console.log('🚀 Zonaliser starting...');

  // Authenticate with Zoho and resolve OAuth tokens before accepting requests.
  await initAuth();

  const app = express();

  // Allow the Vite dev frontend to make cross-origin requests to the API.
  app.use(cors({ origin: 'http://localhost:5173' }));
  // Parse JSON request bodies for all incoming API requests.
  app.use(express.json());
  // Mount all API routes under the `/api` prefix.
  app.use('/api', apiRouter);

  app.listen(config.port, () => {
    console.log(`🌐 API server running at http://localhost:${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/api/health`);
    console.log(`   Status: http://localhost:${config.port}/api/status`);
    console.log(`   Auto-sync: every hour (cron: '0 * * * *')`);

    // Scheduled full sync — runs every hour at minute 0.
    // The sync routine itself includes a rate limiter (≤25 req/min) to
    // avoid exceeding Zoho's API quota and getting locked out.
    cron.schedule('0 * * * *', () => {
      console.log('⏰ Scheduled sync triggered by cron');
      executeFullSync().catch(console.error);
    });
  });
}

// Kick off the bootstrap sequence. On failure, log the error and exit the
// process so that a process manager (e.g. PM2, systemd, Docker) can handle
// the restart. Missing environment variables are the most common cause.
bootstrap().catch((err: Error) => {
  console.error('\n❌ Startup failed:', err.message);
  console.error('   Check your ~/.zshrc environment variables.\n');
  process.exit(1);
});
