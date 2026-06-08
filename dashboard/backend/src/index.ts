import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config';
import { initAuth } from './services/zohoAuth';
import { syncZohoProjects } from './services/zohoProjects';
import { syncAll } from './services/zohoSprints';
import { touchLastSyncedAt } from './services/syncStatus';
import apiRouter from './api/router';

/**
 * Executes a full data synchronization with Zoho Sprints.
 * Updates projects, sprints, issues, and updates the last sync timestamp.
 */
async function runFullSync(): Promise<void> {
  try {
    console.log('⏱  Full sync starting…');
    await syncZohoProjects();
    await syncAll();
    await touchLastSyncedAt();
    console.log('✅ Full sync complete');
  } catch (err) {
    console.error('⚠️  Full sync failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Bootstraps the Express server and initializes the application.
 * 
 * Performs authentication initialization, sets up middleware (CORS, JSON parsing),
 * mounts API routes, and starts the HTTP server with cron-based auto-sync.
 */
async function bootstrap(): Promise<void> {
  console.log('🚀 Zonaliser starting...');

  await initAuth();

  const app = express();

  app.use(cors({ origin: 'http://localhost:5173' }));
  app.use(express.json());
  app.use('/api', apiRouter);

  app.listen(config.port, () => {
    console.log(`🌐 API server running at http://localhost:${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/api/health`);
    console.log(`   Status: http://localhost:${config.port}/api/status`);
    console.log(`   Auto-sync: every 3 hours (cron: '0 */3 * * *')`);

    // Scheduled sync — every 3 hours
    // Rate limiter inside syncAll ensures ≤25 Zoho req/min, so no API lockouts
    cron.schedule('0 */3 * * *', () => {
      console.log('⏰ Scheduled sync triggered by cron');
      runFullSync().catch(console.error);
    });
  });
}

bootstrap().catch((err: Error) => {
  console.error('\n❌ Startup failed:', err.message);
  console.error('   Check your ~/.zshrc environment variables.\n');
  process.exit(1);
});
