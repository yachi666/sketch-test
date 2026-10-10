import { PlanProposalSchema, WorkerIdentitySchema } from '@sketch-test/generation-protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { sendError } from '../../shared/errors.js';
import { authenticateAiWorker } from '../generation/ai-worker.auth.js';
import { GenerationError } from '../generation/generation.service.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import * as service from './plan-generation.service.js';
export async function planGenerationRoutes(app: FastifyInstance) {
  app.get('/api/plan-suggestions', async (req) => ({
    jobs: await service.listPlanJobs(authenticatedUser(req).workspaceId),
    settings: await service.planSettings(authenticatedUser(req).workspaceId),
  }));
  const create = z
    .object({
      agentId: z.string().optional(),
      objective: z.string().trim().min(1).max(4096),
      parentId: z.string().optional(),
      revision: z.number().int().optional(),
    })
    .strict();
  app.post('/api/plan-suggestions', async (req, reply) => {
    const body = create.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', '填写测试目标。');
    try {
      return {
        job: await service.enqueuePlan(
          authenticatedUser(req).workspaceId,
          body.data.objective,
          body.data.parentId,
          body.data.revision,
          body.data.agentId,
        ),
      };
    } catch (e) {
      if (e instanceof GenerationError)
        return sendError(reply, e.statusCode, 'PLAN_ERROR', e.message);
      throw e;
    }
  });
  app.put('/api/plan-suggestions/settings', async (req, reply) => {
    const body = z
      .object({ enabled: z.boolean(), agentId: z.string().optional() })
      .strict()
      .safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', '无效设置');
    try {
      return await service.setPlanSettings(
        authenticatedUser(req).workspaceId,
        body.data.enabled,
        body.data.agentId,
      );
    } catch (e) {
      if (e instanceof GenerationError)
        return sendError(reply, e.statusCode, 'PLAN_ERROR', e.message);
      throw e;
    }
  });
  for (const action of ['save', 'publish', 'cancel'] as const) {
    app.post(`/api/plan-suggestions/:id/${action}`, async (req, reply) => {
      const body = z
        .object({
          revision: z.number().int().nonnegative(),
          proposal: PlanProposalSchema.optional(),
        })
        .strict()
        .safeParse(req.body);
      if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', '无效计划草稿');
      const workspace = authenticatedUser(req).workspaceId;
      const { id } = req.params as { id: string };
      try {
        if (action === 'save')
          return {
            job: await service.savePlanDraft(workspace, id, body.data.revision, body.data.proposal),
          };
        if (action === 'publish') return service.publishPlan(workspace, id, body.data.revision);
        await service.cancelPlan(workspace, id);
        return { ok: true };
      } catch (e) {
        if (e instanceof GenerationError)
          return sendError(reply, e.statusCode, 'PLAN_ERROR', e.message);
        throw e;
      }
    });
  }
  app.post(
    '/api/ai-worker/plans/claim',
    { preHandler: authenticateAiWorker },
    async (req, reply) => {
      const body = WorkerIdentitySchema.safeParse(req.body);
      if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid identity');
      return {
        lease: await service.claimPlan(process.env['AI_WORKER_WORKSPACE_ID'] as string, body.data),
      };
    },
  );
  for (const action of ['heartbeat', 'complete', 'fail'] as const) {
    app.post(
      `/api/ai-worker/plans/:id/${action}`,
      { preHandler: authenticateAiWorker, bodyLimit: 1024 * 1024 },
      async (req, reply) => {
        const body = z
          .object({
            workerId: z.string(),
            leaseToken: z.string().uuid(),
            result: z.unknown().optional(),
            errorCode: z.string().optional(),
          })
          .strict()
          .safeParse(req.body);
        if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid lease');
        try {
          await service.planLeaseAction(
            process.env['AI_WORKER_WORKSPACE_ID'] as string,
            (req.params as { id: string }).id,
            body.data.workerId,
            body.data.leaseToken,
            action,
            body.data.result,
          );
          return { ok: true };
        } catch (e) {
          if (e instanceof GenerationError)
            return sendError(reply, e.statusCode, 'PLAN_ERROR', e.message);
          throw e;
        }
      },
    );
  }
}
