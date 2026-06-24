/**
 * Environment & Secret Management — Fastify Routes
 *
 * Schema version: environment-routes/v1
 *
 * Secret endpoint invariant: list/get never return encrypted_value or value.
 * Only POST /api/secrets/:id/decrypt returns a plaintext secret, and only with
 * a valid runner token.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  createEnvironment,
  createEnvironmentVersion,
  createSecret,
  decryptSecret,
  deleteEnvironment,
  deleteSecret,
  getEnvironment,
  getEnvironmentVersion,
  getSecret,
  listEnvironments,
  listEnvironmentVersions,
  listSecrets,
  updateEnvironment,
  updateSecret,
} from './environment.service.js';

// ── Runner auth for decrypt endpoint ──

const RUNNER_SECRET_TOKEN = process.env['RUNNER_SECRET_TOKEN'] ?? 'sketch-test-runner-dev-token';

function checkRunnerAuth(headers: Record<string, string | undefined>): boolean {
  const token = headers['x-runner-token'];
  return token === RUNNER_SECRET_TOKEN;
}

// ── Strip encrypted_value from secret responses ──

interface SafeSecret {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

function toSafeSecret(secret: {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}): SafeSecret {
  return {
    id: secret.id,
    name: secret.name,
    description: secret.description,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

// ── Validation schemas ──

const CreateEnvironmentSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  name: z.string().min(1, 'name is required').max(255),
  description: z.string().max(4096).optional(),
});

const UpdateEnvironmentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(4096).optional(),
});

const CreateEnvironmentVersionSchema = z.object({
  baseUrl: z.string().min(1, 'baseUrl is required').max(4096),
  variables: z.record(z.string(), z.unknown()).optional(),
  runnerLabels: z.array(z.string()).optional(),
  requireApproval: z.boolean().optional(),
});

const CreateSecretSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  name: z.string().min(1, 'name is required').max(255),
  value: z.string().min(1, 'value is required'),
  description: z.string().max(4096).optional(),
});

const UpdateSecretSchema = z.object({
  value: z.string().min(1, 'value is required'),
  description: z.string().max(4096).optional(),
});

// ── Route registration ──

export async function environmentRoutes(app: FastifyInstance): Promise<void> {
  // ── Environment routes ──

  /** POST /api/environments — Create a new environment (with version 1). */
  app.post('/api/environments', async (request, reply) => {
    const parsed = CreateEnvironmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid environment data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const env = await createEnvironment(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.description,
      );
      reply.status(201).send(env);
    } catch (err) {
      console.error('[environment] Failed to create environment:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create environment');
    }
  });

  /** GET /api/environments — List environments in a workspace. */
  app.get('/api/environments', async (request, reply) => {
    const workspaceId = (request.query as Record<string, string>)['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter workspaceId is required');
    }

    try {
      const environments = await listEnvironments(workspaceId);
      reply.send({ environments });
    } catch (err) {
      console.error('[environment] Failed to list environments:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list environments');
    }
  });

  /** GET /api/environments/:id — Get an environment by ID. */
  app.get('/api/environments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const env = await getEnvironment(id);
      if (!env) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment ${id} not found`);
      }
      reply.send(env);
    } catch (err) {
      console.error('[environment] Failed to get environment:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get environment');
    }
  });

  /** PATCH /api/environments/:id — Update an environment's name/description. */
  app.patch('/api/environments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateEnvironmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid update data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const env = await updateEnvironment(id, parsed.data.name, parsed.data.description);
      if (!env) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment ${id} not found`);
      }
      reply.send(env);
    } catch (err) {
      console.error('[environment] Failed to update environment:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update environment');
    }
  });

  /** DELETE /api/environments/:id — Delete an environment (if no schedules reference it). */
  app.delete('/api/environments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const deleted = await deleteEnvironment(id);
      if (!deleted) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment ${id} not found`);
      }
      reply.status(204).send();
    } catch (err) {
      if (err instanceof Error && err.message.includes('referenced by')) {
        return sendError(reply, 409, 'CONFLICT', err.message);
      }
      console.error('[environment] Failed to delete environment:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete environment');
    }
  });

  // ── Environment version routes ──

  /** POST /api/environments/:id/versions — Create a new version for an environment. */
  app.post('/api/environments/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = CreateEnvironmentVersionSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid version data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      // Verify the environment exists
      const env = await getEnvironment(id);
      if (!env) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment ${id} not found`);
      }

      const version = await createEnvironmentVersion(
        id,
        parsed.data.baseUrl,
        parsed.data.variables ?? {},
        parsed.data.runnerLabels ?? [],
        parsed.data.requireApproval ?? false,
      );
      reply.status(201).send(version);
    } catch (err) {
      console.error('[environment] Failed to create environment version:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create environment version');
    }
  });

  /** GET /api/environments/:id/versions — List all versions for an environment. */
  app.get('/api/environments/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const env = await getEnvironment(id);
      if (!env) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment ${id} not found`);
      }

      const versions = await listEnvironmentVersions(id);
      reply.send({ versions });
    } catch (err) {
      console.error('[environment] Failed to list environment versions:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list environment versions');
    }
  });

  /** GET /api/environment-versions/:id — Get a specific version by ID. */
  app.get('/api/environment-versions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const version = await getEnvironmentVersion(id);
      if (!version) {
        return sendError(reply, 404, 'NOT_FOUND', `Environment version ${id} not found`);
      }
      reply.send(version);
    } catch (err) {
      console.error('[environment] Failed to get environment version:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get environment version');
    }
  });

  // ── Secret routes ──

  /** POST /api/secrets — Create a new secret. Never returns encrypted_value. */
  app.post('/api/secrets', async (request, reply) => {
    const parsed = CreateSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid secret data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const secret = await createSecret(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.value,
        parsed.data.description,
      );
      reply.status(201).send(toSafeSecret(secret));
    } catch (err) {
      console.error('[environment] Failed to create secret:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create secret');
    }
  });

  /** GET /api/secrets — List secrets in a workspace. Never returns encrypted_value. */
  app.get('/api/secrets', async (request, reply) => {
    const workspaceId = (request.query as Record<string, string>)['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter workspaceId is required');
    }

    try {
      const secrets = await listSecrets(workspaceId);
      reply.send({ secrets: secrets.map(toSafeSecret) });
    } catch (err) {
      console.error('[environment] Failed to list secrets:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list secrets');
    }
  });

  /** PATCH /api/secrets/:id — Update a secret's value. Never returns encrypted_value. */
  app.patch('/api/secrets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSecretSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid secret data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const secret = await updateSecret(id, parsed.data.value, parsed.data.description);
      if (!secret) {
        return sendError(reply, 404, 'NOT_FOUND', `Secret ${id} not found`);
      }
      reply.send(toSafeSecret(secret));
    } catch (err) {
      console.error('[environment] Failed to update secret:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update secret');
    }
  });

  /** DELETE /api/secrets/:id — Delete a secret. */
  app.delete('/api/secrets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const deleted = await deleteSecret(id);
      if (!deleted) {
        return sendError(reply, 404, 'NOT_FOUND', `Secret ${id} not found`);
      }
      reply.status(204).send();
    } catch (err) {
      console.error('[environment] Failed to delete secret:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete secret');
    }
  });

  /**
   * POST /api/secrets/:id/decrypt — Decrypt a secret's value.
   * Requires x-runner-token header. Logs an audit event on use.
   * This is the ONLY endpoint that returns a plaintext secret value.
   */
  app.post('/api/secrets/:id/decrypt', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Auth check
    if (!checkRunnerAuth(request.headers as Record<string, string | undefined>)) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid or missing runner token');
    }

    try {
      const secret = await getSecret(id);
      if (!secret) {
        return sendError(reply, 404, 'NOT_FOUND', `Secret ${id} not found`);
      }

      if (!secret.encryptedValue) {
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Secret has no encrypted value');
      }

      const plaintext = decryptSecret(secret.encryptedValue);

      // Audit log
      console.log(
        `[audit] Secret decrypted: id=${secret.id} name=${secret.name} ` +
          `timestamp=${new Date().toISOString()}`,
      );

      reply.send({ value: plaintext });
    } catch (err) {
      console.error('[environment] Failed to decrypt secret:', err);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to decrypt secret');
    }
  });
}
