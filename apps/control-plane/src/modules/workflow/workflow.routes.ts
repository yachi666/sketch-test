import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  compileWorkflowPreview,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowVersion,
  listWorkflows,
  listWorkflowVersions,
  publishVersion,
  saveDraft,
  updateWorkflow,
} from './workflow.service.js';

// ─── Request Schemas ─────────────────────────────────────────────

const CreateWorkflowBodySchema = z.object({
  workspaceId: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
});

const UpdateWorkflowBodySchema = z.object({
  name: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).optional(),
});

const SaveDraftBodySchema = z.object({
  definition: z.object({
    schemaVersion: z.string().optional(),
    name: z.string().min(1).max(256),
    steps: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).max(256),
          useTest: z.string().min(1).max(256).optional(),
          method: z.string().min(1).max(10).optional(),
          url: z.string().max(4096).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.unknown().optional(),
          extract: z
            .array(
              z.object({
                name: z.string().min(1).max(128),
                source: z.string().min(1).max(10),
                expression: z.string().min(1).max(1024),
                scope: z.string().max(10).optional(),
              }),
            )
            .optional(),
          assertions: z
            .array(
              z.object({
                target: z.string().min(1).max(64),
                operator: z.string().min(1).max(64),
                expected: z.unknown().optional(),
                description: z.string().max(1024).optional(),
              }),
            )
            .optional(),
          onFailure: z.string().max(32).optional(),
          maxRetries: z.number().int().min(0).max(10).optional(),
          timeoutMs: z.number().int().positive().max(300_000).optional(),
          enabled: z.boolean().optional(),
          sideEffect: z.string().max(32).optional(),
        }),
      )
      .min(1)
      .max(50),
    teardown: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).max(256),
          method: z.string().min(1).max(10),
          url: z.string().max(4096),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.unknown().optional(),
          maxRetries: z.number().int().min(0).max(3).optional(),
          enabled: z.boolean().optional(),
        }),
      )
      .max(20)
      .optional(),
  }),
});

const PublishBodySchema = z.object({
  publishedBy: z.string().min(1).max(128).optional(),
});

const CompileBodySchema = z.object({
  definition: z.object({
    schemaVersion: z.string().optional(),
    name: z.string().min(1).max(256),
    steps: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).max(256),
          useTest: z.string().min(1).max(256).optional(),
          method: z.string().min(1).max(10).optional(),
          url: z.string().max(4096).optional(),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.unknown().optional(),
          extract: z
            .array(
              z.object({
                name: z.string().min(1).max(128),
                source: z.string().min(1).max(10),
                expression: z.string().min(1).max(1024),
                scope: z.string().max(10).optional(),
              }),
            )
            .optional(),
          assertions: z
            .array(
              z.object({
                target: z.string().min(1).max(64),
                operator: z.string().min(1).max(64),
                expected: z.unknown().optional(),
                description: z.string().max(1024).optional(),
              }),
            )
            .optional(),
          onFailure: z.string().max(32).optional(),
          maxRetries: z.number().int().min(0).max(10).optional(),
          timeoutMs: z.number().int().positive().max(300_000).optional(),
          enabled: z.boolean().optional(),
          sideEffect: z.string().max(32).optional(),
        }),
      )
      .min(1)
      .max(50),
    teardown: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          name: z.string().min(1).max(256),
          method: z.string().min(1).max(10),
          url: z.string().max(4096),
          headers: z.record(z.string(), z.string()).optional(),
          body: z.unknown().optional(),
          maxRetries: z.number().int().min(0).max(3).optional(),
          enabled: z.boolean().optional(),
        }),
      )
      .max(20)
      .optional(),
  }),
});

// ─── Routes ──────────────────────────────────────────────────────

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/workflows — Create a new workflow. */
  app.post('/api/workflows', async (request, reply) => {
    const parsed = CreateWorkflowBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid workflow data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const workflow = await createWorkflow(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.description,
      );
      reply.status(201).send({ workflow });
    } catch (err) {
      console.error('[workflow] create error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create workflow');
    }
  });

  /** GET /api/workflows — List workflows for a workspace. */
  app.get('/api/workflows', async (request, reply) => {
    const { workspaceId } = request.query as { workspaceId?: string };
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'workspaceId query parameter is required', [
        { field: 'workspaceId', message: 'Missing required parameter' },
      ]);
    }

    try {
      const workflows = await listWorkflows(workspaceId);
      reply.send({ workflows });
    } catch (err) {
      console.error('[workflow] list error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list workflows');
    }
  });

  /** GET /api/workflows/:id — Get a workflow with its latest version. */
  app.get('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const workflow = await getWorkflow(id);
      if (!workflow) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow ${id} not found`);
      }
      reply.send({ workflow });
    } catch (err) {
      console.error('[workflow] get error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get workflow');
    }
  });

  /** PATCH /api/workflows/:id — Update a workflow. */
  app.patch('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateWorkflowBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid update data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const workflow = await updateWorkflow(id, parsed.data.name, parsed.data.description);
      if (!workflow) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow ${id} not found`);
      }
      reply.send({ workflow });
    } catch (err) {
      console.error('[workflow] update error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update workflow');
    }
  });

  /** DELETE /api/workflows/:id — Delete a workflow. */
  app.delete('/api/workflows/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      await deleteWorkflow(id);
      reply.status(204).send();
    } catch (err) {
      console.error('[workflow] delete error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete workflow');
    }
  });

  /** POST /api/workflows/:id/versions — Save a new draft version. */
  app.post('/api/workflows/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = SaveDraftBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid workflow definition', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      // Verify the workflow exists
      const workflow = await getWorkflow(id);
      if (!workflow) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow ${id} not found`);
      }

      const version = await saveDraft(id, parsed.data.definition);
      reply.status(201).send({ version });
    } catch (err) {
      console.error('[workflow] saveDraft error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to save draft');
    }
  });

  /** GET /api/workflows/:id/versions — List versions for a workflow. */
  app.get('/api/workflows/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const versions = await listWorkflowVersions(id);
      reply.send({ versions });
    } catch (err) {
      console.error('[workflow] listVersions error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list versions');
    }
  });

  /** GET /api/workflow-versions/:id — Get a specific workflow version. */
  app.get('/api/workflow-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getWorkflowVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow version ${id} not found`);
      }
      reply.send({ version });
    } catch (err) {
      console.error('[workflow] getVersion error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get version');
    }
  });

  /** POST /api/workflow-versions/:id/publish — Compile and publish a version. */
  app.post('/api/workflow-versions/:id/publish', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PublishBodySchema.safeParse(request.body);
    const publishedBy = parsed.success ? parsed.data.publishedBy : undefined;

    try {
      const result = await publishVersion(id, publishedBy);
      if (!result.compileResult.success) {
        return reply.status(422).send({
          published: false,
          diagnostics: result.compileResult.diagnostics,
        });
      }
      reply.send({
        published: true,
        version: {
          id: result.version.id,
          workflowId: result.version.workflowId,
          version: result.version.version,
          publishedBy: result.version.publishedBy,
          publishedAt: result.version.publishedAt,
        },
        plan: result.version.compiledPlan,
        diagnostics: result.compileResult.diagnostics,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[workflow] publish error:', message);

      if (message.includes('not found')) {
        return sendError(reply, 404, 'NOT_FOUND', message);
      }
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to publish version');
    }
  });

  /** POST /api/workflow-versions/:id/compile — Compile without publishing (preview). */
  app.post('/api/workflow-versions/:id/compile', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getWorkflowVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow version ${id} not found`);
      }

      const result = await compileWorkflowPreview(version.definition);
      reply.send({
        success: result.success,
        plan: result.plan ?? null,
        diagnostics: result.diagnostics,
      });
    } catch (err) {
      console.error('[workflow] compile error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to compile');
    }
  });

  /** POST /api/workflows/compile — Compile a definition directly (preview, no persistence). */
  app.post('/api/workflows/compile', async (request, reply) => {
    const parsed = CompileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid workflow definition', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await compileWorkflowPreview(parsed.data.definition);
      reply.send({
        success: result.success,
        plan: result.plan ?? null,
        diagnostics: result.diagnostics,
      });
    } catch (err) {
      console.error('[workflow] compile preview error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to compile');
    }
  });

  /** GET /api/workflow-versions/:id/plan — Get the compiled ExecutionPlan for a version. */
  app.get('/api/workflow-versions/:id/plan', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getWorkflowVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Workflow version ${id} not found`);
      }
      if (!version.compiledPlan) {
        return sendError(
          reply,
          404,
          'NO_PLAN',
          `Workflow version ${id} has no compiled plan — it may not be published yet`,
        );
      }
      reply.send({ plan: version.compiledPlan });
    } catch (err) {
      console.error('[workflow] getPlan error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get plan');
    }
  });
}
