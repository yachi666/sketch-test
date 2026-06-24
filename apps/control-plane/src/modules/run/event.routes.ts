import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { verifyRunnerToken } from '../runner-registry/runner-registry.service.js';
import { insertEvents, buildEvidenceManifest, verifyEvidenceIntegrity } from './event.service.js';

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
    const tokenInfo = verifyRunnerToken(token);
    if (!tokenInfo) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or unknown runner token');
    }

    const parsed = EventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid events payload', [
        { field: 'body', message: parsed.error.message },
      ]);
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
    const manifest = await buildEvidenceManifest(id);
    reply.send(manifest);
  });

  /** Verify evidence integrity for a run. */
  app.get('/api/runs/:id/evidence-verify', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await verifyEvidenceIntegrity(id);
    reply.send(result);
  });
}
