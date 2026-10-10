import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { pool } from '../../db/db.js';
import { sendError } from '../../shared/errors.js';
import { GenerationError } from '../generation/generation.service.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import { runPublishedTest } from './published-test-run.service.js';
import {
  createPersistedRunFromSteps,
  createRunFromWorkflow,
  getApiVersion,
  getRun,
} from './run.service.js';
import { queryRuns, RunQuerySchema } from './run-query.service.js';

const CustomRunBodySchema = z.object({
  steps: z
    .array(
      z.object({
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY']),
        url: z.string().min(1).max(4096),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.unknown().optional(),
        assertions: z
          .array(
            z.object({
              description: z.string().max(1024).optional(),
              target: z.enum(['status', 'header', 'jsonPath', 'body', 'responseTime']),
              path: z.string().max(1024).optional(),
              operator: z.enum([
                'equals',
                'notEquals',
                'contains',
                'notContains',
                'exists',
                'notExists',
                'greaterThan',
                'lessThan',
              ]),
              expected: z.unknown().optional(),
              severity: z.enum(['block', 'warn']).default('block'),
            }),
          )
          .optional(),
        extractions: z
          .array(
            z.object({
              name: z.string().min(1).max(128),
              source: z.enum(['body', 'header', 'cookie', 'status']),
              expression: z.string().min(1).max(1024),
              sensitive: z.boolean().default(false),
            }),
          )
          .optional(),
        timeoutMs: z.number().int().positive().max(300_000).default(30_000),
      }),
    )
    .min(1)
    .max(50),
});

export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/test-case-versions/:id/run', async (request, reply) => {
    const parsed = z
      .object({
        environmentVersionId: z.string().min(1),
        confirmSideEffects: z.boolean().default(false),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return sendError(reply, 400, 'INVALID_INPUT', 'Select an environment version');
    try {
      return reply
        .status(201)
        .send(
          await runPublishedTest(
            authenticatedUser(request).workspaceId,
            (request.params as { id: string }).id,
            parsed.data.environmentVersionId,
            parsed.data.confirmSideEffects,
          ),
        );
    } catch (error) {
      if (error instanceof GenerationError)
        return sendError(reply, error.statusCode, 'RUN_ERROR', error.message);
      throw error;
    }
  });
  /** List all imported API versions. */
  app.get('/api/api-versions', async (request, reply) => {
    const result = await pool.query(
      `SELECT id, source_type, source_location, content_hash, created_at,
              spec_json->'metadata'->>'sourceLabel' as label,
              jsonb_array_length(spec_json->'endpoints') as endpoint_count,
              jsonb_array_length(spec_json->'diagnostics') as diagnostic_count
       FROM api_versions
       WHERE workspace_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [authenticatedUser(request).workspaceId],
    );
    reply.send({
      apiVersions: result.rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        sourceLocation: row.source_location,
        contentHash: row.content_hash,
        createdAt: row.created_at,
        label: row.label,
        endpointCount: row.endpoint_count,
        diagnosticCount: row.diagnostic_count,
      })),
    });
  });

  /** Get a single API version with its endpoints. */
  app.get('/api/api-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const apiVersion = await getApiVersion(id);
    if (!apiVersion) {
      return sendError(reply, 404, 'NOT_FOUND', `API version ${id} not found`);
    }

    const spec = apiVersion.spec_json;
    reply.send({
      id: apiVersion.id,
      sourceType: apiVersion.source_type,
      sourceLocation: apiVersion.source_location,
      contentHash: apiVersion.content_hash,
      createdAt: apiVersion.created_at,
      metadata: spec.metadata,
      endpoints: spec.endpoints ?? [],
      schemas: spec.schemas ?? {},
      diagnostics: spec.diagnostics ?? [],
      servers: spec.servers ?? [],
    });
  });

  /** Create a Run from custom steps. */
  app.post('/api/runs', async (request, reply) => {
    const parsed = CustomRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid run definition', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    const { runId, plan } = await createPersistedRunFromSteps(
      authenticatedUser(request).workspaceId,
      parsed.data.steps,
    );
    reply.status(201).send({ runId, plan });
  });

  /** Create a Run from a published workflow version. */
  app.post('/api/runs/from-workflow', async (request, reply) => {
    const parsed = z
      .object({
        workflowVersionId: z.string().min(1).max(256),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await createRunFromWorkflow(
        parsed.data.workflowVersionId,
        authenticatedUser(request).workspaceId,
      );
      reply.status(201).send({
        runId: result.runId,
        workflowVersionId: result.workflowVersionId,
        plan: result.plan,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[run] createRunFromWorkflow error:', message);

      if (message.includes('not found')) {
        return sendError(reply, 404, 'NOT_FOUND', message);
      }
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create run from workflow');
    }
  });

  /** List all runs. */
  app.get('/api/runs', async (request, reply) => {
    const parsed = RunQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid run filters');
    reply.send(await queryRuns(authenticatedUser(request).workspaceId, parsed.data));
  });

  /** Get a single run with its step events. */
  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await getRun(id);
    if (!run) {
      return sendError(reply, 404, 'NOT_FOUND', `Run ${id} not found`);
    }

    const eventsResult = await pool.query(
      `SELECT * FROM step_events WHERE run_id = $1 ORDER BY step_index, created_at`,
      [id],
    );

    reply.send({
      run: {
        id: run.id,
        apiVersionId: run.apiVersionId,
        status: run.status,
        runnerId: run.runnerId,
        claimedAt: run.claimedAt,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      },
      steps: eventsResult.rows.map((e) => ({
        stepIndex: e.step_index,
        eventType: e.event_type,
        payload: e.payload_json,
        createdAt: e.created_at,
      })),
    });
  });
}
