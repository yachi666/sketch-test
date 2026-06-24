/**
 * @sketch-test/control-plane — M1 API Server
 *
 * Fastify server with IAM, API import, runner orchestration, and reporting.
 *
 * Invariants:
 * - Runner and Web are separate processes; CP is their only shared contract.
 * - Auth is simplified dev-auth (in-memory session tokens) for M1.
 * - Database: PostgreSQL via `pg` (no ORM).
 */

import Fastify from 'fastify';
import { runMigrations } from './db/db.js';
import { datasetRoutes } from './modules/dataset/dataset.routes.js';
import { environmentRoutes } from './modules/environment/environment.routes.js';
import { generationRoutes } from './modules/generation/generation.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { iamRoutes } from './modules/iam/iam.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { policyRoutes } from './modules/policy/policy.routes.js';
import { reportRoutes } from './modules/report/report.routes.js';
import { eventRoutes } from './modules/run/event.routes.js';
import { leaseRoutes } from './modules/run/lease.routes.js';
import { runRoutes } from './modules/run/run.routes.js';
import { scheduleRoutes } from './modules/run/schedule.routes.js';
import { runnerRegistryRoutes } from './modules/runner-registry/runner-registry.routes.js';
import { testAuthoringRoutes } from './modules/test-authoring/test-authoring.routes.js';
import { testSuiteRoutes } from './modules/test-suite/test-suite.routes.js';
import { workflowRoutes } from './modules/workflow/workflow.routes.js';

const PORT = parseInt(process.env['CP_PORT'] ?? '3802', 10);
const HOST = process.env['CP_HOST'] ?? '0.0.0.0';

async function main(): Promise<void> {
  // Run database migrations
  await runMigrations();

  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
  });

  // Register routes
  await healthRoutes(app);
  await importRoutes(app);
  await runRoutes(app);
  await leaseRoutes(app);
  await eventRoutes(app);
  await reportRoutes(app);
  await runnerRegistryRoutes(app);
  await iamRoutes(app);
  await environmentRoutes(app);
  await workflowRoutes(app);
  await testAuthoringRoutes(app);
  await generationRoutes(app);
  await scheduleRoutes(app);
  await testSuiteRoutes(app);
  await datasetRoutes(app);
  await policyRoutes(app);

  // Start server
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[control-plane] Listening on http://${HOST}:${PORT}`);
    console.log(`[control-plane] Health check: http://localhost:${PORT}/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
