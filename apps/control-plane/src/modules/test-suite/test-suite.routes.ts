/**
 * Test Suite Routes — Fastify route definitions for test suites and quality gates.
 *
 * All request bodies are validated with Zod. Errors use the shared sendError helper.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  createTestSuite,
  createTestSuiteVersion,
  deleteTestSuite,
  evaluateQualityGate,
  getTestSuite,
  getTestSuiteVersion,
  getTestSuiteWithLatestVersion,
  listTestSuites,
  listTestSuiteVersions,
  RunNotFoundError,
  TestSuiteNotFoundError,
  TestSuiteVersionNotFoundError,
} from './test-suite.service.js';

// ── Zod schemas ────────────────────────────────────────────────────────────────────

const CreateTestSuiteSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

const TestSuiteMemberSchema = z.object({
  type: z.enum(['test', 'workflow']),
  id: z.string().min(1),
});

const CreateTestSuiteVersionSchema = z.object({
  members: z.array(TestSuiteMemberSchema).default([]),
  qualityGate: z
    .object({
      requiredWorkflows: z.array(z.string()).optional(),
      noNewFailures: z.boolean().optional(),
      maxFlakyRetries: z.number().int().nonnegative().optional(),
      minEndpointCoverage: z.number().min(0).max(100).optional(),
      requiredTags: z.array(z.string()).optional(),
      blockOnInfraError: z.boolean().optional(),
    })
    .default({}),
});

const EvaluateQualityGateSchema = z.object({
  runId: z.string().min(1),
});

// ── Routes ─────────────────────────────────────────────────────────────────────────

export async function testSuiteRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Test Suites
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/test-suites — Create a test suite. */
  app.post('/api/test-suites', async (request, reply) => {
    const parsed = CreateTestSuiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid test suite data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const suite = await createTestSuite(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.description,
      );
      reply.status(201).send({ testSuite: suite });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to create test suite');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** GET /api/test-suites — List test suites in a workspace. */
  app.get('/api/test-suites', async (request, reply) => {
    const workspaceId = (request.query as Record<string, string>)['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter workspaceId is required');
    }

    try {
      const suites = await listTestSuites(workspaceId);
      reply.send({ testSuites: suites });
    } catch (err) {
      request.log.error({ err }, 'Failed to list test suites');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list test suites');
    }
  });

  /** GET /api/test-suites/:id — Get a test suite with its latest version. */
  app.get('/api/test-suites/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const result = await getTestSuiteWithLatestVersion(id);
      if (!result) {
        return sendError(reply, 404, 'NOT_FOUND', `Test suite ${id} not found`);
      }
      reply.send({
        testSuite: result.suite,
        latestVersion: result.latestVersion,
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to get test suite');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get test suite');
    }
  });

  /** DELETE /api/test-suites/:id — Delete a test suite and all its versions. */
  app.delete('/api/test-suites/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const suite = await getTestSuite(id);
      if (!suite) {
        return sendError(reply, 404, 'NOT_FOUND', `Test suite ${id} not found`);
      }
      await deleteTestSuite(id);
      reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, 'Failed to delete test suite');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete test suite');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test Suite Versions (scoped to a test suite)
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/test-suites/:id/versions — Create a new version of a test suite. */
  app.post('/api/test-suites/:id/versions', async (request, reply) => {
    const { id: testSuiteId } = request.params as { id: string };
    const parsed = CreateTestSuiteVersionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid version data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const version = await createTestSuiteVersion(
        testSuiteId,
        parsed.data.members,
        parsed.data.qualityGate,
      );
      reply.status(201).send({ version });
    } catch (err) {
      if (err instanceof TestSuiteNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('duplicate key') || message.includes('UNIQUE')) {
        return sendError(
          reply,
          409,
          'CONFLICT',
          `Version already exists for test suite ${testSuiteId}`,
        );
      }
      request.log.error({ err }, 'Failed to create test suite version');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** GET /api/test-suites/:id/versions — List all versions of a test suite. */
  app.get('/api/test-suites/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const versions = await listTestSuiteVersions(id);
      reply.send({ versions });
    } catch (err) {
      request.log.error({ err }, 'Failed to list test suite versions');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list test suite versions');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Test Suite Versions (by version ID)
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/test-suite-versions/:id — Get a specific test suite version. */
  app.get('/api/test-suite-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getTestSuiteVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Test suite version ${id} not found`);
      }
      reply.send({ version });
    } catch (err) {
      request.log.error({ err }, 'Failed to get test suite version');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get test suite version');
    }
  });

  /** POST /api/test-suite-versions/:id/evaluate — Evaluate a run against a quality gate. */
  app.post('/api/test-suite-versions/:id/evaluate', async (request, reply) => {
    const { id: versionId } = request.params as { id: string };
    const parsed = EvaluateQualityGateSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid evaluation request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await evaluateQualityGate(parsed.data.runId, versionId);
      reply.send(result);
    } catch (err) {
      if (err instanceof TestSuiteVersionNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      if (err instanceof RunNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      request.log.error({ err }, 'Failed to evaluate quality gate');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to evaluate quality gate');
    }
  });
}
