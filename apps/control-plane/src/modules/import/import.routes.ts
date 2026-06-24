import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { ImportError, importApiSpec } from './import.service.js';
import { diffApiVersions, DiffError } from './diff.service.js';

const ImportBodySchema = z.object({
  sourceType: z.enum(['file', 'url']),
  sourceLocation: z.string().min(1).max(4096),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  /** Import an OpenAPI/RAML spec from file or URL. */
  app.post('/api/import', async (request, reply) => {
    const parsed = ImportBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid import request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await importApiSpec(parsed.data);
      reply.status(201).send(result);
    } catch (err) {
      if (err instanceof ImportError) {
        return sendError(reply, 422, 'IMPORT_FAILED', err.message);
      }
      console.error('[import] Unexpected error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  /** Compare two API versions and return a structured diff. */
  app.get('/api/api-versions/:targetId/diff', async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    const { baseId } = request.query as { baseId?: string };

    if (!baseId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter "baseId" is required');
    }

    try {
      const result = await diffApiVersions(baseId, targetId);
      reply.send(result);
    } catch (err) {
      if (err instanceof DiffError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      console.error('[diff] Unexpected error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });
}
