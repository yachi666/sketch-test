import { AgentConfigSchema, ConnectionConfigSchema } from '@sketch-test/generation-protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod/v3';
import { sendError } from '../../shared/errors.js';
import { aiCapabilities } from '../generation/ai-generation.service.js';
import { GenerationError } from '../generation/generation.service.js';
import { authenticatedUser } from '../iam/auth.middleware.js';
import {
  addConnection,
  agentVersions,
  caseProvenance,
  connections,
  execution,
  listAgents,
  saveAgent,
} from './agents.service.js';

async function respond(reply: FastifyReply, work: () => Promise<unknown>) {
  try {
    return await work();
  } catch (e) {
    if (e instanceof GenerationError)
      return sendError(reply, e.statusCode, 'AGENT_ERROR', e.message);
    throw e;
  }
}
export async function agentsRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (req) => ({
    agents: await listAgents(authenticatedUser(req).workspaceId),
  }));
  app.post('/api/agents', async (req, reply) => {
    const config = AgentConfigSchema.safeParse(req.body);
    if (!config.success) return sendError(reply, 400, 'INVALID_INPUT', 'Agent 配置无效');
    const u = authenticatedUser(req);
    return respond(reply, async () => {
      const agent = await saveAgent(u.workspaceId, u.id, config.data);
      reply.code(201);
      return { agent };
    });
  });
  app.put('/api/agents/:id', async (req, reply) => {
    const body = z
      .object({ config: AgentConfigSchema, expectedVersion: z.number().int().positive() })
      .strict()
      .safeParse(req.body);
    if (!body.success) return sendError(reply, 400, 'INVALID_INPUT', 'Agent 配置或版本无效');
    const u = authenticatedUser(req);
    return respond(reply, async () => ({
      agent: await saveAgent(
        u.workspaceId,
        u.id,
        body.data.config,
        (req.params as { id: string }).id,
        body.data.expectedVersion,
      ),
    }));
  });
  app.get('/api/agents/:id/versions', async (req, reply) =>
    respond(reply, async () => ({
      versions: await agentVersions(
        authenticatedUser(req).workspaceId,
        (req.params as { id: string }).id,
      ),
    })),
  );
  app.get('/api/provider-connections', async (req) => ({
    connections: await connections(authenticatedUser(req).workspaceId),
  }));
  app.post('/api/provider-connections', async (req, reply) => {
    const config = ConnectionConfigSchema.safeParse(req.body);
    if (!config.success)
      return sendError(reply, 400, 'INVALID_INPUT', '连接配置无效；请只填写 Worker 连接引用');
    return respond(reply, async () => {
      const connection = await addConnection(authenticatedUser(req).workspaceId, config.data);
      reply.code(201);
      return { connection };
    });
  });
  app.post('/api/provider-connections/:id/check', async (req, reply) =>
    respond(reply, async () => {
      const ws = authenticatedUser(req).workspaceId;
      const c = (await connections(ws)).find((c) => c.id === (req.params as { id: string }).id);
      if (!c) throw new GenerationError('连接不存在', 404);
      const live = (await aiCapabilities(ws)).workers.filter(
        (w) =>
          w.agentConfigVersion === 1 &&
          w.provider === c.provider &&
          (w.connectionRef ?? 'default') === c.connectionRef,
      );
      return {
        available: live.length > 0,
        models: live.map((w) => w.model),
        check: 'worker-heartbeat',
        message: live.length
          ? 'Worker 在线；模型凭据有效性以真实生成结果为准'
          : '没有匹配的在线 Worker',
      };
    }),
  );
  app.get('/api/generation-jobs/:id/execution', async (req, reply) =>
    respond(reply, () =>
      execution(authenticatedUser(req).workspaceId, (req.params as { id: string }).id),
    ),
  );
  app.get('/api/test-cases/:id/provenance', async (req, reply) =>
    respond(reply, async () => ({
      sources: await caseProvenance(
        authenticatedUser(req).workspaceId,
        (req.params as { id: string }).id,
      ),
    })),
  );
}
