import type { FastifyInstance } from 'fastify';
import { healthCheck } from '../../db/db.js';
import { metrics } from '../../shared/metrics.js';
import { objectStorageHealthCheck } from '../../shared/object-storage.js';

export async function observabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_request, reply) => {
    const [db, storage] = await Promise.all([
      healthCheck().catch(() => false),
      objectStorageHealthCheck().catch(() => false),
    ]);
    metrics.recordDependency('postgres', db);
    metrics.recordDependency('object-store', storage);
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
  });
}
