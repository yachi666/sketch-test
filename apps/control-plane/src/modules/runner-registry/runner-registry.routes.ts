/**
 * Runner Registry Routes
 *
 * Endpoints for runner registration, heartbeat, status management, and deregistration.
 * The heartbeat endpoint authenticates via the X-Runner-Token header.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  registerRunner,
  getRunner,
  listRunners,
  recordHeartbeat,
  updateRunnerStatus,
  deleteRunner,
  verifyRunnerToken,
} from './runner-registry.service.js';

const RegisterBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(256),
  version: z.string().max(64).optional(),
  labels: z.array(z.string().max(128)).max(50).optional(),
});

const StatusBodySchema = z.object({
  status: z.enum(['online', 'offline', 'draining']),
});

const HeartbeatBodySchema = z.object({
  capacity: z.record(z.unknown()).optional(),
});

export async function runnerRegistryRoutes(app: FastifyInstance): Promise<void> {
  /** Register a new runner. Returns an ID and token. */
  app.post('/api/runners/register', async (request, reply) => {
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid registration payload', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    const { workspaceId, name, version, labels } = parsed.data;
    const result = await registerRunner(workspaceId, name, version, labels);
    reply.status(201).send(result);
  });

  /** List all runners in a workspace. */
  app.get('/api/runners', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const workspaceId = query['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'workspaceId query parameter is required');
    }

    const runners = await listRunners(workspaceId);
    reply.send({ runners });
  });

  /** Get a runner by ID. */
  app.get('/api/runners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const runner = await getRunner(id);
    if (!runner) {
      return sendError(reply, 404, 'NOT_FOUND', `Runner ${id} not found`);
    }
    reply.send({ runner });
  });

  /** Update runner status. */
  app.patch('/api/runners/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = StatusBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid status', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    const runner = await updateRunnerStatus(id, parsed.data.status);
    if (!runner) {
      return sendError(reply, 404, 'NOT_FOUND', `Runner ${id} not found`);
    }
    reply.send({ runner });
  });

  /** Deregister a runner. */
  app.delete('/api/runners/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const runner = await getRunner(id);
    if (!runner) {
      return sendError(reply, 404, 'NOT_FOUND', `Runner ${id} not found`);
    }

    await deleteRunner(id);
    reply.status(204).send();
  });

  /** Record a heartbeat. Authenticated via X-Runner-Token header. */
  app.post('/api/runners/:id/heartbeat', async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = (request.headers['x-runner-token'] as string) ?? '';

    // Verify the token belongs to this runner
    const tokenInfo = await verifyRunnerToken(token);
    if (!tokenInfo || tokenInfo.runnerId !== id) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or missing runner token');
    }

    const parsed = HeartbeatBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid heartbeat payload', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    await recordHeartbeat(id, parsed.data.capacity);
    reply.send({ acknowledged: true });
  });
}
