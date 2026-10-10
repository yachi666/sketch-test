import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';
import { verifyRunnerToken } from '../runner-registry/runner-registry.service.js';
import { claimNextRun, claimRun, updateRunStatus } from './lease.service.js';

/**
 * Extract and verify the X-Runner-Token header.
 * Returns the verified workspace-scoped Runner identity, or sends a 401.
 */
async function authenticateRunner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ runnerId: string; workspaceId: string } | null> {
  const token = (request.headers['x-runner-token'] as string | undefined) ?? '';
  if (!token) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Missing X-Runner-Token header');
    return null;
  }

  const tokenInfo = await verifyRunnerToken(token);
  if (!tokenInfo) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or unknown runner token');
    return null;
  }

  return tokenInfo;
}

export async function leaseRoutes(app: FastifyInstance): Promise<void> {
  /** Runner polls for the next pending run. Long-poll: waits up to 30s. */
  app.get('/api/runs/next', async (request, reply) => {
    const runner = await authenticateRunner(request, reply);
    if (!runner) return;

    // Simple polling with timeout (30s loop with 1s interval)
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      const claimed = await claimNextRun(runner.runnerId, runner.workspaceId);
      if (claimed) {
        return reply.send({ run: { id: claimed.id, plan: claimed.plan } });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    reply.status(204).send();
  });

  /** Runner explicitly claims a specific run. */
  app.put('/api/runs/:id/claim', async (request, reply) => {
    const runner = await authenticateRunner(request, reply);
    if (!runner) return;

    const { id } = request.params as { id: string };

    const claimed = await claimRun(id, runner.runnerId, runner.workspaceId);
    if (!claimed) {
      return sendError(reply, 409, 'ALREADY_CLAIMED', `Run ${id} is not available`);
    }

    reply.send({ claimed: true, runId: id });
  });

  /** Runner updates run status. */
  app.patch('/api/runs/:id', async (request, reply) => {
    const runner = await authenticateRunner(request, reply);
    if (!runner) return;

    const { id } = request.params as { id: string };
    const body = request.body as { status?: string };
    if (!body.status) {
      return sendError(reply, 400, 'INVALID_INPUT', 'status is required');
    }

    const ok = await updateRunStatus(id, body.status, runner.runnerId, runner.workspaceId);
    if (!ok) {
      return sendError(reply, 404, 'NOT_FOUND', `Run ${id} not found or not owned by this runner`);
    }

    reply.send({ updated: true });
  });
}
