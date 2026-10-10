import { CanonicalApiModelSchema } from '@sketch-test/canonical-api-model';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { pool } from '../../db/db.js';
import { sendError } from '../../shared/errors.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import { DiffError, diffApiVersions } from './diff.service.js';
import { createEndpointDefinition } from './endpoint-definition.service.js';
import { ImportError, importApiSpec, importPostmanV3Bundle } from './import.service.js';
import { importRepository, RepositoryError } from './repository.service.js';

const ImportBodySchema = z.object({
  sourceType: z.literal('url'),
  sourceLocation: z.string().min(1).max(4096),
});

const PostmanV3ImportBodySchema = z.object({
  sourceLocation: z.string().min(1).max(4096),
  rootPath: z.string().max(1024).optional(),
  files: z
    .record(z.string().min(1).max(1024), z.string().max(2 * 1024 * 1024))
    .refine((files) => Object.keys(files).length > 0 && Object.keys(files).length <= 500, {
      message: 'Postman v3 import requires between 1 and 500 UTF-8 files.',
    })
    .refine(
      (files) =>
        Object.entries(files).reduce(
          (total, [path, content]) => total + path.length + content.length,
          0,
        ) <=
        10 * 1024 * 1024,
      { message: 'Postman v3 import bundle exceeds the 10 MiB limit.' },
    ),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/import/repository', async (request, reply) => {
    const parsed = z
      .object({
        repositoryUrl: z.string().min(1).max(256),
        ref: z.string().max(200).optional(),
        directory: z.string().max(240).optional(),
      })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return sendError(reply, 400, 'INVALID_INPUT', '仓库 URL、分支或扫描目录格式无效。');
    try {
      return reply
        .status(201)
        .send(await importRepository(authenticatedUser(request).workspaceId, parsed.data));
    } catch (error) {
      if (error instanceof RepositoryError)
        return sendError(reply, error.statusCode, 'REPOSITORY_IMPORT_FAILED', error.message);
      return sendError(reply, 500, 'REPOSITORY_IMPORT_FAILED', '仓库分析未完成，请重试。');
    }
  });
  /** Import an OpenAPI document from an administrator-allowed URL. */
  app.post('/api/import', async (request, reply) => {
    const parsed = ImportBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid import request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await importApiSpec({
        ...parsed.data,
        workspaceId: authenticatedUser(request).workspaceId,
      });
      reply.status(201).send(result);
    } catch (err) {
      if (err instanceof ImportError) {
        return sendError(reply, 422, 'IMPORT_FAILED', err.message);
      }
      console.error('[import] Unexpected error:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  /**
   * Import a Postman Collection v3 directory bundle. The caller sends a
   * virtual file map because v3 is intentionally multi-file YAML, not a
   * single upload. All files are preserved in immutable object storage.
   */
  app.post('/api/import/postman/v3', async (request, reply) => {
    const parsed = PostmanV3ImportBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid Postman v3 import request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }
    try {
      const result = await importPostmanV3Bundle({
        workspaceId: authenticatedUser(request).workspaceId,
        sourceLocation: parsed.data.sourceLocation,
        bundle: { files: parsed.data.files, rootPath: parsed.data.rootPath },
      });
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof ImportError) {
        return sendError(reply, 422, 'POSTMAN_V3_IMPORT_FAILED', error.message);
      }
      console.error('[import] Unexpected Postman v3 import error:', error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });

  /**
   * Return a derived, portable OpenAPI YAML document for one imported endpoint.
   * The original source remains immutable in object storage; this endpoint is a
   * read-only view over the published CanonicalApiModel.
   */
  app.get('/api/api-versions/:id/endpoints/:endpointId/openapi', async (request, reply) => {
    const { id, endpointId } = request.params as { id: string; endpointId: string };
    const result = await pool.query(
      `SELECT source_type, spec_json
       FROM api_versions
       WHERE id = $1 AND workspace_id = $2`,
      [id, authenticatedUser(request).workspaceId],
    );
    if (result.rows.length === 0) {
      return sendError(reply, 404, 'NOT_FOUND', `API version ${id} not found`);
    }

    const parsed = CanonicalApiModelSchema.safeParse(result.rows[0]?.spec_json);
    if (!parsed.success) {
      console.error(
        '[import] Stored API version failed canonical validation:',
        parsed.error.message,
      );
      return sendError(reply, 500, 'INVALID_API_VERSION', 'Stored API version is invalid');
    }
    const endpoint = parsed.data.endpoints.find((candidate) => candidate.id === endpointId);
    if (!endpoint) {
      return sendError(
        reply,
        404,
        'NOT_FOUND',
        `Endpoint ${endpointId} not found in API version ${id}`,
      );
    }

    const definition = createEndpointDefinition(
      parsed.data,
      endpoint,
      result.rows[0]?.source_type as string,
    );
    reply.send(definition);
  });

  /** Compare two API versions and return a structured diff. */
  app.get('/api/api-versions/:targetId/diff', async (request, reply) => {
    const { targetId } = request.params as { targetId: string };
    const { baseId } = request.query as { baseId?: string };

    if (!baseId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter "baseId" is required');
    }

    try {
      const result = await diffApiVersions(
        baseId,
        targetId,
        authenticatedUser(request).workspaceId,
      );
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
