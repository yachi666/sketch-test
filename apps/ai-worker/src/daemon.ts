import { randomUUID } from 'node:crypto';
import { configuredModel } from './model.js';
import { runWorker, WorkerClient } from './worker.js';

async function main() {
  const { model } = configuredModel();
  const client = new WorkerClient(
    process.env['CP_URL'] ?? 'http://127.0.0.1:3802',
    process.env['AI_WORKER_TOKEN'] ?? '',
  );
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const identity = {
    capabilities: ['plan' as const],
    agentConfigVersion: 1 as const,
    connectionRef: process.env['AI_CONNECTION_REF'] ?? 'default',
    workerId: process.env['AI_WORKER_ID'] ?? `ai_${randomUUID()}`,
    provider: model.provider,
    model: model.id,
    harnessVersion: '1.1.0',
  };
  await Promise.all([
    runWorker(client, identity, controller.signal),
    runWorker(client, identity, controller.signal, undefined, 'plan'),
  ]);
}
main().catch(() => {
  process.stderr.write('AI Worker configuration is invalid.\n');
  process.exitCode = 1;
});
