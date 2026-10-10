import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from '../../shared/errors.js';

export const AI_WORKER_ROUTES = new Set([
  'POST /api/ai-worker/plans/claim',
  'POST /api/ai-worker/plans/:id/heartbeat',
  'POST /api/ai-worker/plans/:id/complete',
  'POST /api/ai-worker/plans/:id/fail',
  'POST /api/ai-worker/heartbeat',
  'POST /api/ai-worker/claim',
  'POST /api/ai-worker/jobs/:id/heartbeat',
  'POST /api/ai-worker/jobs/:id/complete',
  'POST /api/ai-worker/jobs/:id/fail',
]);
export async function authenticateAiWorker(request: FastifyRequest, reply: FastifyReply) {
  const token = process.env['AI_WORKER_TOKEN'];
  const given = request.headers.authorization?.replace(/^Bearer /, '');
  if (
    !token ||
    token.length < 32 ||
    !process.env['AI_WORKER_WORKSPACE_ID'] ||
    !given ||
    Buffer.byteLength(given) !== Buffer.byteLength(token) ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(token))
  )
    return sendError(reply, 401, 'UNAUTHORIZED', 'Invalid AI Worker credential');
}
