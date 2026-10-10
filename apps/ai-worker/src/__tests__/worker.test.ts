import { createServer } from 'node:http';
import { GenerationLeaseSchema } from '@sketch-test/generation-protocol';
import { expect, test } from 'vitest';
import { executeLease, WorkerClient } from '../worker.js';

test('worker transport sends its dedicated credential and refuses redirected credentials', async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    expect(request.headers.authorization).toBe(`Bearer ${'x'.repeat(32)}`);
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/unexpected' });
      response.end();
    } else {
      response.setHeader('content-type', 'application/json');
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const client = new WorkerClient(`http://127.0.0.1:${address.port}`, 'x'.repeat(32));
    expect(await client.post('/heartbeat', {})).toEqual({ ok: true });
    await expect(client.post('/redirect', {})).rejects.toThrow();
    expect(calls).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('remote transport requires TLS and strong credentials', () => {
  expect(() => new WorkerClient('http://example.test', 'x'.repeat(32))).toThrow('HTTPS');
  expect(() => new WorkerClient('https://example.test', 'short')).toThrow();
});
test('supervisor terminates a cancelled task without a result', async () => {
  const lease = GenerationLeaseSchema.parse({
    leaseToken: 'a270ff84-4eae-4dc0-a44a-59c721cdcf15',
    attempt: 1,
    task: {
      schemaVersion: 'sketch-test.generation/v1',
      jobId: 'job_1',
      workspaceId: 'ws_1',
      apiVersionId: 'av_1',
      sourceHash: 'a'.repeat(64),
      objective: 'Health',
      endpoints: [
        {
          id: 'health',
          method: 'GET',
          path: '/health',
          summary: 'Health',
          responseStatusCodes: [200],
          sideEffect: 'read-only',
        },
      ],
    },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(executeLease(lease, controller.signal)).rejects.toThrow('CANCELLED');
});
