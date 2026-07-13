/**
 * @sketch-test/control-plane — production API server
 *
 * Fastify server with IAM, API import, runner orchestration, and reporting.
 *
 * Invariants:
 * - Runner and Web are separate processes; CP is their only shared contract.
 * - Authentication uses signed JWTs and persisted identities.
 * - Database: PostgreSQL via `pg` (no ORM).
 */

import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { runMigrations } from './db/db.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { datasetRoutes } from './modules/dataset/dataset.routes.js';
import { environmentRoutes } from './modules/environment/environment.routes.js';
import { generationRoutes } from './modules/generation/generation.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { authorizeControlPlaneRequest } from './modules/iam/authorization.middleware.js';
import { iamRoutes } from './modules/iam/iam.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { observabilityRoutes } from './modules/observability/observability.routes.js';
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
import { loadControlPlaneConfig } from './shared/config.js';
import { metrics } from './shared/metrics.js';

async function main(): Promise<void> {
  const config = loadControlPlaneConfig();
  // Run database migrations
  await runMigrations();

  const app = Fastify({
    genReqId: (request) => {
      const supplied = request.headers['x-request-id'];
      const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
      return candidate && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
    },
    logger: {
      level: config.logLevel,
    },
  });

  await app.register(cors, {
    origin: config.webOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Runner-Token'],
    exposedHeaders: ['X-Request-ID'],
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    metrics.recordHttp(
      request.method,
      request.routeOptions.url ?? 'unmatched',
      reply.statusCode,
      reply.elapsedTime,
    );
  });
  app.addHook('preHandler', authorizeControlPlaneRequest);

  // Register routes
  await healthRoutes(app);
  await observabilityRoutes(app);
  await auditRoutes(app);
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
    await app.listen({ port: config.port, host: config.host });
    console.log(`[control-plane] Listening on http://${config.host}:${config.port}`);
    console.log(`[control-plane] Health check: http://localhost:${config.port}/health`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
