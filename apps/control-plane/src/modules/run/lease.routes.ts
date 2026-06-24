import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';
import { verifyRunnerToken } from '../runner-registry/runner-registry.service.js';
import { claimNextRun, updateRunStatus } from './lease.service.js';

/**
 * Extract and verify the X-Runner-Token header.
 * Returns the verified runnerId, or sends a 401 and returns null.
 */
function authenticateRunner(request: FastifyRequest, reply: FastifyReply): string | null {
  const token = (request.headers['x-runner-token'] as string | undefined) ?? '';
  if (!token) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Missing X-Runner-Token header');
    return null;
  }

  const tokenInfo = verifyRunnerToken(token);
  if (!tokenInfo) {
    sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or unknown runner token');
    return null;
  }

  return tokenInfo.runnerId;
}

export async function leaseRoutes(app: FastifyInstance): Promise<void> {
  /** Runner polls for the next pending run. Long-poll: waits up to 30s. */
  app.get('/api/runs/next', async (request, reply) => {
    const runnerId = authenticateRunner(request, reply);
    if (!runnerId) return;

    // Simple polling with timeout (30s loop with 1s interval)
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      const claimed = await claimNextRun(runnerId);
      if (claimed) {
        return reply.send({ run: { id: claimed.id, plan: claimed.plan } });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    reply.status(204).send();
  });

  /** Runner explicitly claims a specific run. */
  app.put('/api/runs/:id/claim', async (request, reply) => {
    const runnerId = authenticateRunner(request, reply);
    if (!runnerId) return;

    const { id } = request.params as { id: string };

    const claimed = await claimNextRun(runnerId);
    if (!claimed || claimed.id !== id) {
      return sendError(reply, 409, 'ALREADY_CLAIMED', `Run ${id} is not available`);
    }

    reply.send({ claimed: true, runId: id });
  });

  /** Runner updates run status. */
  app.patch('/api/runs/:id', async (request, reply) => {
    const runnerId = authenticateRunner(request, reply);
    if (!runnerId) return;

    const { id } = request.params as { id: string };
    const body = request.body as { status?: string };
    if (!body.status) {
      return sendError(reply, 400, 'INVALID_INPUT', 'status is required');
    }

    const ok = await updateRunStatus(id, body.status, runnerId);
    if (!ok) {
      return sendError(reply, 404, 'NOT_FOUND', `Run ${id} not found or not owned by this runner`);
    }

    reply.send({ updated: true });
  });
}
