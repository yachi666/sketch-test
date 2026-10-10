import { WorkerIdentitySchema } from '@sketch-test/generation-protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { sendError } from '../../shared/errors.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import {
  aiCapabilities,
  changeAiGeneration,
  claimAiGeneration,
  completeAiGeneration,
  failAiGeneration,
  renewAiGeneration,
  workerHeartbeat,
} from './ai-generation.service.js';
import { authenticateAiWorker } from './ai-worker.auth.js';
import { GenerationError } from './generation.service.js';

const LeaseBody = z
  .object({
    workerId: z.string().min(1).max(128),
    leaseToken: z.string().uuid(),
    result: z.unknown().optional(),
    errorCode: z.enum(['MODEL_FAILED', 'TIMEOUT', 'INVALID_RESULT']).optional(),
  })
  .strict();
export async function aiGenerationRoutes(app: FastifyInstance) {
  app.get('/api/ai/capabilities', async (request) =>
    aiCapabilities(authenticatedUser(request).workspaceId),
  );
  for (const action of ['heartbeat', 'claim'] as const) {
    app.post(
      `/api/ai-worker/${action}`,
      { preHandler: authenticateAiWorker },
      async (request, reply) => {
        const parsed = WorkerIdentitySchema.safeParse(request.body);
        if (!parsed.success)
          return sendError(reply, 400, 'INVALID_INPUT', 'Invalid Worker identity');
        const workspaceId = process.env['AI_WORKER_WORKSPACE_ID'] as string;
        if (action === 'heartbeat') {
          await workerHeartbeat(workspaceId, parsed.data);
          return { ok: true };
        }
        return { lease: await claimAiGeneration(workspaceId, parsed.data) };
      },
    );
  }
  for (const action of ['heartbeat', 'complete', 'fail'] as const) {
    app.post(
      `/api/ai-worker/jobs/:id/${action}`,
      { preHandler: authenticateAiWorker, bodyLimit: 1024 * 1024 },
      async (request, reply) => {
        const parsed = LeaseBody.safeParse(request.body);
        if (!parsed.success)
          return sendError(reply, 400, 'INVALID_INPUT', 'Invalid lease envelope');
        const { id } = request.params as { id: string };
        const { workerId, leaseToken, result, errorCode } = parsed.data;
        const workspaceId = process.env['AI_WORKER_WORKSPACE_ID'] as string;
        try {
          if (action === 'heartbeat')
            await renewAiGeneration(workspaceId, id, workerId, leaseToken);
          else if (action === 'complete')
            await completeAiGeneration(workspaceId, id, workerId, leaseToken, result);
          else
            await failAiGeneration(
              workspaceId,
              id,
              workerId,
              leaseToken,
              errorCode ?? 'MODEL_FAILED',
            );
          return { ok: true };
        } catch (error) {
          if (error instanceof GenerationError)
            return sendError(reply, error.statusCode, 'GENERATION_ERROR', error.message);
          throw error;
        }
      },
    );
  }
  for (const action of ['cancel', 'retry'] as const) {
    app.post(`/api/generation-jobs/:id/${action}`, async (request, reply) => {
      try {
        await changeAiGeneration(
          authenticatedUser(request).workspaceId,
          (request.params as { id: string }).id,
          action,
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof GenerationError)
          return sendError(reply, error.statusCode, 'GENERATION_ERROR', error.message);
        throw error;
      }
    });
  }
}
