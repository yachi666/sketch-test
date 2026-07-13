import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { verifyRunnerToken } from '../runner-registry/runner-registry.service.js';
import {
  getPersistedEvidenceManifest,
  insertEvents,
  persistEvidenceManifest,
  verifyEvidenceIntegrity,
} from './event.service.js';
import { runnerOwnsRun } from './lease.service.js';

const EventsBodySchema = z.object({
  events: z.array(
    z.object({
      id: z.string().optional(),
      runId: z.string().min(1),
      stepIndex: z.number().int().nonnegative(),
      eventType: z.string().min(1),
      payload: z.unknown(),
    }),
  ),
});

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  /** Runner uploads batch of step events. Authenticated via X-Runner-Token. */
  app.post('/api/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = (request.headers['x-runner-token'] as string) ?? '';

    if (!token) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Missing X-Runner-Token header');
    }
    const tokenInfo = await verifyRunnerToken(token);
    if (!tokenInfo) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or unknown runner token');
    }
    if (!(await runnerOwnsRun(id, tokenInfo.runnerId, tokenInfo.workspaceId))) {
      return sendError(reply, 404, 'NOT_FOUND', `Run ${id} not found`);
    }

    const parsed = EventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid events payload', [
        { field: 'body', message: parsed.error.message },
      ]);
    }
    if (parsed.data.events.some((event) => event.runId !== id)) {
      return sendError(
        reply,
        400,
        'INVALID_INPUT',
        'Every event runId must match the route run ID',
      );
    }

    const { accepted, duplicates, contentHashes } = await insertEvents(
      id,
      parsed.data.events.map((e) => ({
        id: e.id,
        runId: e.runId,
        stepIndex: e.stepIndex,
        eventType: e.eventType,
        payload: e.payload,
      })),
    );
    reply.status(201).send({ accepted, duplicates, contentHashCount: contentHashes.length });
  });

  /** Get evidence manifest for a run (content hashes, sizes, integrity chain). */
  app.get('/api/runs/:id/evidence-manifest', async (request, reply) => {
    const { id } = request.params as { id: string };
    const manifest = await getPersistedEvidenceManifest(id);
    if (!manifest) return sendError(reply, 404, 'NOT_FOUND', `No evidence manifest for run ${id}`);
    reply.send(manifest);
  });

  /** Materialize an immutable manifest in object storage. Runner-authenticated. */
  app.post('/api/runs/:id/evidence-manifest', async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = (request.headers['x-runner-token'] as string) ?? '';
    const tokenInfo = token ? await verifyRunnerToken(token) : null;
    if (!tokenInfo) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or missing runner token');
    }
    if (!(await runnerOwnsRun(id, tokenInfo.runnerId, tokenInfo.workspaceId))) {
      return sendError(reply, 404, 'NOT_FOUND', `Run ${id} not found`);
    }
    const manifest = await persistEvidenceManifest(id);
    reply.status(201).send(manifest);
  });

  /** Verify evidence integrity for a run. */
  app.get('/api/runs/:id/evidence-verify', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await verifyEvidenceIntegrity(id);
    reply.send(result);
  });
}
