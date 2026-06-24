/**
 * Dataset Routes — Fastify route definitions for datasets and dataset versions.
 *
 * All request bodies are validated with Zod. Errors use the shared sendError helper.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  createDataset,
  createDatasetVersion,
  DatasetNotFoundError,
  deleteDataset,
  getDataset,
  getDatasetVersion,
  importDatasetFromCsv,
  importDatasetFromJson,
  listDatasets,
  listDatasetVersions,
} from './dataset.service.js';

// ── Zod schemas ────────────────────────────────────────────────────────────────────

const CreateDatasetSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
});

const CreateDatasetVersionSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
  sensitiveFields: z.array(z.string()).optional(),
});

const ImportJsonSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  data: z.string().min(1),
});

const ImportCsvSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  data: z.string().min(1),
});

// ── Routes ─────────────────────────────────────────────────────────────────────────

export async function datasetRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Datasets
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/datasets — Create a dataset. */
  app.post('/api/datasets', async (request, reply) => {
    const parsed = CreateDatasetSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid dataset data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const dataset = await createDataset(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.description,
      );
      reply.status(201).send({ dataset });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to create dataset');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** GET /api/datasets — List datasets in a workspace. */
  app.get('/api/datasets', async (request, reply) => {
    const workspaceId = (request.query as Record<string, string>)['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter workspaceId is required');
    }

    try {
      const datasets = await listDatasets(workspaceId);
      reply.send({ datasets });
    } catch (err) {
      request.log.error({ err }, 'Failed to list datasets');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list datasets');
    }
  });

  /** GET /api/datasets/:id — Get a dataset by ID. */
  app.get('/api/datasets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const dataset = await getDataset(id);
      if (!dataset) {
        return sendError(reply, 404, 'NOT_FOUND', `Dataset ${id} not found`);
      }
      reply.send({ dataset });
    } catch (err) {
      request.log.error({ err }, 'Failed to get dataset');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get dataset');
    }
  });

  /** DELETE /api/datasets/:id — Delete a dataset and all its versions. */
  app.delete('/api/datasets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const dataset = await getDataset(id);
      if (!dataset) {
        return sendError(reply, 404, 'NOT_FOUND', `Dataset ${id} not found`);
      }
      await deleteDataset(id);
      reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, 'Failed to delete dataset');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete dataset');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dataset Versions (scoped to a dataset)
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/datasets/:id/versions — Create a new version of a dataset. */
  app.post('/api/datasets/:id/versions', async (request, reply) => {
    const { id: datasetId } = request.params as { id: string };
    const parsed = CreateDatasetVersionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid version data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const version = await createDatasetVersion(
        datasetId,
        parsed.data.rows,
        parsed.data.sensitiveFields,
      );
      reply.status(201).send({ version });
    } catch (err) {
      if (err instanceof DatasetNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('duplicate key') || message.includes('UNIQUE')) {
        return sendError(reply, 409, 'CONFLICT', `Version already exists for dataset ${datasetId}`);
      }
      request.log.error({ err }, 'Failed to create dataset version');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** GET /api/datasets/:id/versions — List all versions of a dataset. */
  app.get('/api/datasets/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const versions = await listDatasetVersions(id);
      reply.send({ versions });
    } catch (err) {
      request.log.error({ err }, 'Failed to list dataset versions');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list dataset versions');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dataset Versions (by version ID)
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /api/dataset-versions/:id — Get a specific dataset version (masked). */
  app.get('/api/dataset-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const version = await getDatasetVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Dataset version ${id} not found`);
      }
      reply.send({ version });
    } catch (err) {
      request.log.error({ err }, 'Failed to get dataset version');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get dataset version');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Import
  // ═══════════════════════════════════════════════════════════════════════════

  /** POST /api/datasets/import/json — Import a dataset from a JSON array. */
  app.post('/api/datasets/import/json', async (request, reply) => {
    const parsed = ImportJsonSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid import data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await importDatasetFromJson(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.data,
      );
      reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (
        message.includes('Invalid JSON') ||
        message.includes('array') ||
        message.includes('at least one row')
      ) {
        return sendError(reply, 422, 'IMPORT_FAILED', message);
      }
      request.log.error({ err }, 'Failed to import JSON dataset');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** POST /api/datasets/import/csv — Import a dataset from CSV. */
  app.post('/api/datasets/import/csv', async (request, reply) => {
    const parsed = ImportCsvSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid import data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await importDatasetFromCsv(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.data,
      );
      reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('header') || message.includes('CSV')) {
        return sendError(reply, 422, 'IMPORT_FAILED', message);
      }
      request.log.error({ err }, 'Failed to import CSV dataset');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });
}
