import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  compareVersions,
  createTestCase,
  deleteTestCase,
  getTestCase,
  getTestCaseVersion,
  listTestCases,
  listTestCaseVersions,
  publishVersion,
  saveDraft,
  TestAuthoringError,
  updateTestCase,
} from './test-authoring.service.js';

// ─── Validation Schemas ────────────────────────────────────────────

const CreateTestCaseBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(256),
  apiVersionId: z.string().optional(),
  description: z.string().max(4096).optional(),
});

const UpdateTestCaseBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).optional(),
});

const SaveDraftBodySchema = z.object({
  definition: z.unknown(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const PublishBodySchema = z.object({
  publishedBy: z.string().max(128).optional(),
});

// ─── Routes ────────────────────────────────────────────────────────

export async function testAuthoringRoutes(app: FastifyInstance): Promise<void> {
  /** Create a new test case. */
  app.post('/api/test-cases', async (request, reply) => {
    const parsed = CreateTestCaseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid test case', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const tc = await createTestCase(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.apiVersionId,
        parsed.data.description,
      );
      reply.status(201).send({
        id: tc.id,
        workspaceId: tc.workspace_id,
        apiVersionId: tc.api_version_id,
        name: tc.name,
        description: tc.description,
        createdAt: tc.created_at,
        updatedAt: tc.updated_at,
      });
    } catch (err) {
      console.error('[test-authoring] createTestCase error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create test case');
    }
  });

  /** List test cases in a workspace. */
  app.get('/api/test-cases', async (request, reply) => {
    const query = request.query as {
      workspaceId?: string;
      apiVersionId?: string;
    };

    if (!query.workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'workspaceId query parameter is required');
    }

    try {
      const tcs = await listTestCases(query.workspaceId, query.apiVersionId);
      reply.send({ testCases: tcs });
    } catch (err) {
      console.error('[test-authoring] listTestCases error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list test cases');
    }
  });

  /** Get a single test case with its latest version. */
  app.get('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const tc = await getTestCase(id);
      if (!tc) {
        return sendError(reply, 404, 'NOT_FOUND', `Test case ${id} not found`);
      }
      reply.send(tc);
    } catch (err) {
      console.error('[test-authoring] getTestCase error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get test case');
    }
  });

  /** Update a test case name/description. */
  app.patch('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateTestCaseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid update payload', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const tc = await updateTestCase(id, parsed.data.name, parsed.data.description);
      if (!tc) {
        return sendError(reply, 404, 'NOT_FOUND', `Test case ${id} not found`);
      }
      reply.send({
        id: tc.id,
        workspaceId: tc.workspace_id,
        apiVersionId: tc.api_version_id,
        name: tc.name,
        description: tc.description,
        createdAt: tc.created_at,
        updatedAt: tc.updated_at,
      });
    } catch (err) {
      console.error('[test-authoring] updateTestCase error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update test case');
    }
  });

  /** Delete a test case and all its versions. */
  app.delete('/api/test-cases/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const deleted = await deleteTestCase(id);
      if (!deleted) {
        return sendError(reply, 404, 'NOT_FOUND', `Test case ${id} not found`);
      }
      reply.status(204).send();
    } catch (err) {
      console.error('[test-authoring] deleteTestCase error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete test case');
    }
  });

  /** Save a draft version for a test case. */
  app.post('/api/test-cases/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SaveDraftBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid draft payload', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const version = await saveDraft(id, parsed.data.definition, parsed.data.expectedRevision);
      reply.status(201).send({
        id: version.id,
        testCaseId: version.test_case_id,
        version: version.version,
        definition: version.definition,
        sideEffect: version.side_effect,
        publishedBy: version.published_by,
        publishedAt: version.published_at,
      });
    } catch (err) {
      if (err instanceof TestAuthoringError) {
        return sendError(reply, err.statusCode, 'TEST_AUTHORING_ERROR', err.message);
      }
      console.error('[test-authoring] saveDraft error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to save draft');
    }
  });

  /** List all versions for a test case. */
  app.get('/api/test-cases/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const versions = await listTestCaseVersions(id);
      reply.send({ versions });
    } catch (err) {
      console.error('[test-authoring] listTestCaseVersions error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list versions');
    }
  });

  /** Get a specific test case version. */
  app.get('/api/test-case-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getTestCaseVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Test case version ${id} not found`);
      }
      reply.send(version);
    } catch (err) {
      console.error('[test-authoring] getTestCaseVersion error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get version');
    }
  });

  /** Publish a test case version. */
  app.post('/api/test-case-versions/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PublishBodySchema.safeParse(request.body);
    const publishedBy = parsed.success ? parsed.data.publishedBy : undefined;

    try {
      const version = await publishVersion(id, publishedBy);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Test case version ${id} not found`);
      }
      reply.send(version);
    } catch (err) {
      console.error('[test-authoring] publishVersion error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to publish version');
    }
  });

  /** Compare two test case versions. */
  app.get('/api/test-case-versions/compare', async (request, reply) => {
    const query = request.query as { a?: string; b?: string };

    if (!query.a || !query.b) {
      return sendError(
        reply,
        400,
        'INVALID_INPUT',
        'Query parameters a and b (version IDs) are required',
      );
    }

    try {
      const diff = await compareVersions(query.a, query.b);
      if (!diff) {
        return sendError(reply, 404, 'NOT_FOUND', 'One or both versions not found');
      }
      reply.send(diff);
    } catch (err) {
      console.error('[test-authoring] compareVersions error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to compare versions');
    }
  });
}
