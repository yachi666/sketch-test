import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { sendError } from '../../shared/errors.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import { enqueueAiGeneration } from './ai-generation.service.js';
import {
  acceptDraft,
  GenerationError,
  generateTests,
  getDraft,
  getGenerationJob,
  listDrafts,
  listGenerationJobs,
  rejectDraft,
} from './generation.service.js';

// ─── Validation Schemas ────────────────────────────────────────────

const StartGenerationBodySchema = z.object({
  workspaceId: z.string().min(1),
  apiVersionId: z.string().min(1),
  strategy: z.enum(['example', 'schema', 'status-codes', 'pi']),
  endpointIds: z.array(z.string()).min(1).max(100).optional(),
  objective: z.string().min(1).max(4096).optional(),
  agentId: z.string().min(1).max(128).optional(),
});

const AcceptDraftBodySchema = z.object({
  reviewedBy: z.string().max(128).optional(),
  modifications: z.unknown().optional(),
});

const RejectDraftBodySchema = z.object({
  reviewedBy: z.string().max(128).optional(),
  reason: z.string().max(4096).optional(),
});

// ─── Routes ────────────────────────────────────────────────────────

export async function generationRoutes(app: FastifyInstance): Promise<void> {
  /** Start a new test generation job. */
  app.post('/api/generation-jobs', async (request, reply) => {
    const parsed = StartGenerationBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid generation request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const job =
        parsed.data.strategy === 'pi'
          ? await enqueueAiGeneration(
              parsed.data.workspaceId,
              parsed.data.apiVersionId,
              parsed.data.objective ?? '依据 API 契约生成可审阅的回归测试，明确缺失的业务预期。',
              parsed.data.endpointIds,
              parsed.data.agentId,
            )
          : await generateTests(
              parsed.data.workspaceId,
              parsed.data.apiVersionId,
              parsed.data.strategy,
              parsed.data.endpointIds,
            );
      reply.status(201).send({
        id: job.id,
        workspaceId: job.workspace_id,
        apiVersionId: job.api_version_id,
        strategy: job.strategy,
        status: job.status,
        createdAt: job.created_at,
      });
    } catch (err) {
      if (err instanceof GenerationError) {
        return sendError(reply, err.statusCode, 'NOT_FOUND', err.message);
      }
      console.error('[generation] generateTests error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to start generation job');
    }
  });

  /** List generation jobs in a workspace. */
  app.get('/api/generation-jobs', async (request, reply) => {
    const query = request.query as { workspaceId?: string };

    if (!query.workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'workspaceId query parameter is required');
    }

    try {
      const jobs = await listGenerationJobs(query.workspaceId);
      reply.send({
        jobs: jobs.map((j) => ({
          id: j.id,
          workspaceId: j.workspace_id,
          apiVersionId: j.api_version_id,
          strategy: j.strategy,
          status: j.status,
          createdAt: j.created_at,
          completedAt: j.completed_at,
          config: j.config,
          attempt: j.attempt,
          draftCount: j.draft_count,
          coveredEndpointCount: j.covered_endpoint_count,
          errorCode: j.error_code,
        })),
      });
    } catch (err) {
      console.error('[generation] listGenerationJobs error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list generation jobs');
    }
  });

  /** Get a generation job's status. */
  app.get('/api/generation-jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const job = await getGenerationJob(id);
      if (!job) {
        return sendError(reply, 404, 'NOT_FOUND', `Generation job ${id} not found`);
      }
      reply.send({
        id: job.id,
        workspaceId: job.workspace_id,
        apiVersionId: job.api_version_id,
        strategy: job.strategy,
        status: job.status,
        config: job.config,
        attempt: job.attempt,
        errorCode: job.error_code,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      });
    } catch (err) {
      console.error('[generation] getGenerationJob error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get generation job');
    }
  });

  /** List drafts for a generation job. */
  app.get('/api/generation-jobs/:id/drafts', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const drafts = await listDrafts(id);
      reply.send({
        drafts: drafts.map((d) => ({
          id: d.id,
          jobId: d.job_id,
          testCaseId: d.test_case_id,
          confidence: d.confidence,
          status: d.status,
          reviewedBy: d.reviewed_by,
          reviewedAt: d.reviewed_at,
          createdAt: d.created_at,
          sourceInfo: d.source_info,
          // Trim definition from list to keep response size reasonable
          // Clients should use GET /api/drafts/:id for full detail
          definitionSummary: {
            name: (d.definition as Record<string, unknown>)?.['name'] ?? 'Untitled',
            sideEffect: (d.definition as Record<string, unknown>)?.['sideEffect'] ?? 'read-only',
          },
        })),
      });
    } catch (err) {
      console.error('[generation] listDrafts error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list drafts');
    }
  });

  /** Get a single draft with full definition. */
  app.get('/api/drafts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const draft = await getDraft(id);
      if (!draft) {
        return sendError(reply, 404, 'NOT_FOUND', `Draft ${id} not found`);
      }
      reply.send({
        id: draft.id,
        jobId: draft.job_id,
        testCaseId: draft.test_case_id,
        definition: draft.definition,
        sourceInfo: draft.source_info,
        confidence: draft.confidence,
        status: draft.status,
        reviewedBy: draft.reviewed_by,
        reviewedAt: draft.reviewed_at,
        createdAt: draft.created_at,
      });
    } catch (err) {
      console.error('[generation] getDraft error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get draft');
    }
  });

  /** Accept a draft (creates test case and version). */
  app.post('/api/drafts/:id/accept', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = AcceptDraftBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid review');

    try {
      const result = await acceptDraft(
        id,
        authenticatedUser(request).id,
        parsed.success ? parsed.data.modifications : undefined,
      );
      reply.status(201).send({
        testCaseId: result.testCaseId,
        versionId: result.versionId,
        version: result.version,
        draft: {
          id: result.draft.id,
          status: result.draft.status,
        },
      });
    } catch (err) {
      if (err instanceof GenerationError) {
        return sendError(reply, err.statusCode, 'GENERATION_ERROR', err.message);
      }
      console.error('[generation] acceptDraft error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to accept draft');
    }
  });

  /** Reject a draft. */
  app.post('/api/drafts/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = RejectDraftBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid review');

    try {
      const draft = await rejectDraft(
        id,
        authenticatedUser(request).id,
        parsed.success ? parsed.data.reason : undefined,
      );
      if (!draft) {
        return sendError(reply, 404, 'NOT_FOUND', `Draft ${id} not found`);
      }
      reply.send({
        id: draft.id,
        jobId: draft.job_id,
        testCaseId: draft.test_case_id,
        confidence: draft.confidence,
        status: draft.status,
        reviewedBy: draft.reviewed_by,
        reviewedAt: draft.reviewed_at,
      });
    } catch (err) {
      if (err instanceof GenerationError) {
        return sendError(reply, err.statusCode, 'GENERATION_ERROR', err.message);
      }
      console.error('[generation] rejectDraft error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to reject draft');
    }
  });
}
