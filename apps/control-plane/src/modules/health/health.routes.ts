import type { FastifyInstance } from 'fastify';
import { healthCheck } from '../../db/db.js';
import { objectStorageHealthCheck } from '../../shared/object-storage.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async (_request, reply) => {
    reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/ready', async (_request, reply) => {
    const [dbOk, objectStoreOk] = await Promise.all([
      healthCheck().catch(() => false),
      objectStorageHealthCheck(),
    ]);
    const ready = dbOk && objectStoreOk;
    reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'not_ready',
      db: dbOk ? 'connected' : 'disconnected',
      objectStore: objectStoreOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', async (_request, reply) => {
    const dbOk = await healthCheck();
    reply.status(dbOk ? 200 : 503).send({
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });
}
