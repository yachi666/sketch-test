/**
 * Policy Routes — Fastify route definitions for access policies.
 *
 * All request bodies are validated with Zod. Errors use the shared sendError helper.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import {
  createPolicy,
  deletePolicy,
  evaluatePolicies,
  getPolicy,
  listPolicies,
  PolicyNotFoundError,
  updatePolicy,
} from './policy.service.js';

// ── Zod schemas ────────────────────────────────────────────────────────────────────

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  condition: z.record(z.string(), z.unknown()),
  effect: z.enum(['allow', 'deny', 'require-approval']),
  priority: z.number().int().default(0),
});

const CreatePolicySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(255),
  rules: z.array(PolicyRuleSchema).default([]),
  description: z.string().max(2000).optional(),
  priority: z.number().int().default(0),
});

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  rules: z.array(PolicyRuleSchema).optional(),
  description: z.string().max(2000).optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

const EvaluatePoliciesSchema = z.object({
  workspaceId: z.string().min(1),
  subject: z
    .object({
      id: z.string().min(1),
      role: z.string().optional(),
    })
    .passthrough(),
  action: z.string().min(1).max(256),
  resource: z.object({}).passthrough(),
  context: z.record(z.string(), z.unknown()).optional(),
});

// ── Routes ─────────────────────────────────────────────────────────────────────────

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/policies — Create a policy. */
  app.post('/api/policies', async (request, reply) => {
    const parsed = CreatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid policy data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const policy = await createPolicy(
        parsed.data.workspaceId,
        parsed.data.name,
        parsed.data.rules,
        parsed.data.description,
        parsed.data.priority,
      );
      reply.status(201).send({ policy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to create policy');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** GET /api/policies — List policies in a workspace. */
  app.get('/api/policies', async (request, reply) => {
    const workspaceId = (request.query as Record<string, string>)['workspaceId'];
    if (!workspaceId) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Query parameter workspaceId is required');
    }

    try {
      const policies = await listPolicies(workspaceId);
      reply.send({ policies });
    } catch (err) {
      request.log.error({ err }, 'Failed to list policies');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to list policies');
    }
  });

  /** GET /api/policies/:id — Get a policy by ID. */
  app.get('/api/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const policy = await getPolicy(id);
      if (!policy) {
        return sendError(reply, 404, 'NOT_FOUND', `Policy ${id} not found`);
      }
      reply.send({ policy });
    } catch (err) {
      request.log.error({ err }, 'Failed to get policy');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get policy');
    }
  });

  /** PATCH /api/policies/:id — Update a policy. Only provided fields are changed. */
  app.patch('/api/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid update data', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const policy = await updatePolicy(id, parsed.data);
      reply.send({ policy });
    } catch (err) {
      if (err instanceof PolicyNotFoundError) {
        return sendError(reply, 404, 'NOT_FOUND', err.message);
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to update policy');
      return sendError(reply, 500, 'INTERNAL_ERROR', message);
    }
  });

  /** DELETE /api/policies/:id — Delete a policy. */
  app.delete('/api/policies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const policy = await getPolicy(id);
      if (!policy) {
        return sendError(reply, 404, 'NOT_FOUND', `Policy ${id} not found`);
      }
      await deletePolicy(id);
      reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, 'Failed to delete policy');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete policy');
    }
  });

  /** POST /api/policies/evaluate — Evaluate policies for an access decision. */
  app.post('/api/policies/evaluate', async (request, reply) => {
    const parsed = EvaluatePoliciesSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT', 'Invalid evaluation request', [
        { field: 'body', message: parsed.error.message },
      ]);
    }

    try {
      const result = await evaluatePolicies(
        parsed.data.workspaceId,
        parsed.data.subject,
        parsed.data.action,
        parsed.data.resource,
        parsed.data.context,
      );
      reply.send(result);
    } catch (err) {
      request.log.error({ err }, 'Failed to evaluate policies');
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to evaluate policies');
    }
  });
}
