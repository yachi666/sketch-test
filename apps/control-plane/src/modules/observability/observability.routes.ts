import type { FastifyInstance } from 'fastify';
import { metrics } from '../../shared/metrics.js';

export async function observabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
  });
}
