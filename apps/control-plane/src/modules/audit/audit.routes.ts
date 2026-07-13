import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../../shared/errors.js';
import { requireAuth } from '../iam/auth.middleware.js';
import { listAuditEvents } from './audit.service.js';

const AuditQuerySchema = z.object({
  workspaceId: z.string().min(1),
  action: z.string().min(1).max(128).optional(),
  resourceType: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/audit-logs',
    { preHandler: requireAuth({ roles: ['owner', 'maintainer'] }) },
    async (request, reply) => {
      const parsed = AuditQuerySchema.safeParse(request.query);
      if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', 'Invalid audit query');
      if (request.user?.workspaceId !== parsed.data.workspaceId) {
        return sendError(reply, 403, 'FORBIDDEN', 'Cannot inspect another workspace audit log');
      }
      const events = await listAuditEvents(parsed.data.workspaceId, parsed.data);
      reply.send({ events });
    },
  );
}
