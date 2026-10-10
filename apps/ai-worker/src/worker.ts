import { spawn } from 'node:child_process';
import {
  type GenerationLease,
  GenerationLeaseSchema,
  GenerationResultSchema,
  type PlanLease,
  PlanLeaseSchema,
  PlanResultSchema,
  type WorkerIdentity,
} from '@sketch-test/generation-protocol';

export class WorkerHttpError extends Error {
  constructor(public status: number) {
    super(`Control Plane HTTP ${status}`);
  }
}
export class WorkerClient {
  readonly url: URL;
  constructor(
    url: string,
    private token: string,
  ) {
    this.url = new URL(url);
    if (
      !['http:', 'https:'].includes(this.url.protocol) ||
      this.url.username ||
      this.url.password ||
      this.url.search ||
      this.url.hash
    )
      throw new Error('Invalid CP_URL');
    if (
      this.url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]', 'control-plane'].includes(this.url.hostname)
    )
      throw new Error('Remote CP_URL requires HTTPS');
    if (token.length < 32) throw new Error('AI_WORKER_TOKEN requires 32+ characters');
  }
  async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.url), {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new WorkerHttpError(response.status);
    return response.json();
  }
}

/** Each task runs in a fresh supervised process: even a noncooperative provider cannot exceed the deadline. */
export function executeLease(
  lease: GenerationLease | PlanLease,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const file = new URL(
      import.meta.url.endsWith('.ts') ? './main.ts' : './main.js',
      import.meta.url,
    );
    const child = spawn(process.execPath, [...process.execArgv, file.pathname], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: process.env,
    });
    let output = '';
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else {
        try {
          resolve(
            (lease.task.schemaVersion === 'sketch-test.plan-generation/v1'
              ? PlanResultSchema
              : GenerationResultSchema
            ).parse(JSON.parse(output)),
          );
        } catch {
          reject(new Error('INVALID_RESULT'));
        }
      }
    };
    const abort = () => finish(new Error('CANCELLED'));
    const timer = setTimeout(
      () => finish(new Error('TIMEOUT')),
      lease.task.limits.timeoutMs + 3000,
    );
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(new Error('MODEL_FAILED')));
    child.stdin.on('error', () => finish(new Error('MODEL_FAILED')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) finish(new Error('INVALID_RESULT'));
      else output += chunk.toString();
    });
    child.once('close', (code) => finish(code === 0 ? undefined : new Error('MODEL_FAILED')));
    if (signal.aborted) abort();
    else child.stdin.end(JSON.stringify(lease.task));
  });
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });

export async function runWorker(
  client: WorkerClient,
  identity: WorkerIdentity,
  signal: AbortSignal,
  execute = executeLease,
  mode: 'test' | 'plan' = 'test',
) {
  while (!signal.aborted) {
    try {
      await client.post('/api/ai-worker/heartbeat', identity);
      const response = (await client.post(
        mode === 'plan' ? '/api/ai-worker/plans/claim' : '/api/ai-worker/claim',
        identity,
      )) as { lease: unknown };
      if (!response.lease) {
        await pause(2000, signal);
        continue;
      }
      const lease =
        mode === 'plan'
          ? PlanLeaseSchema.parse(response.lease)
          : GenerationLeaseSchema.parse(response.lease);
      const jobPath = mode === 'plan' ? 'plans' : 'jobs';
      const controller = new AbortController();
      const shutdown = () => controller.abort();
      signal.addEventListener('abort', shutdown, { once: true });
      const envelope = { workerId: identity.workerId, leaseToken: lease.leaseToken };
      let renewing = false;
      const renew = setInterval(async () => {
        if (renewing) return;
        renewing = true;
        try {
          await client.post(`/api/ai-worker/${jobPath}/${lease.task.jobId}/heartbeat`, envelope);
          await client.post('/api/ai-worker/heartbeat', identity);
        } catch {
          controller.abort();
        } finally {
          renewing = false;
        }
      }, 8000);
      try {
        const result = await execute(lease, controller.signal);
        for (let attempt = 0; attempt < 3; attempt++) {
          if (controller.signal.aborted) throw new Error('CANCELLED');
          try {
            await client.post(`/api/ai-worker/${jobPath}/${lease.task.jobId}/complete`, {
              ...envelope,
              result,
            });
            break;
          } catch (error) {
            if (error instanceof WorkerHttpError && error.status < 500) throw error;
            if (attempt === 2) throw error;
            await pause(1000, controller.signal);
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const code =
            error instanceof Error && ['TIMEOUT', 'INVALID_RESULT'].includes(error.message)
              ? error.message
              : 'MODEL_FAILED';
          // If complete was committed but its response was lost, the fenced fail gets 409 and cannot undo it.
          await client
            .post(`/api/ai-worker/${jobPath}/${lease.task.jobId}/fail`, {
              ...envelope,
              errorCode: code,
            })
            .catch(() => {});
        }
      } finally {
        clearInterval(renew);
        signal.removeEventListener('abort', shutdown);
      }
    } catch {
      // Never log provider errors, task payloads or credentials. Retry after transient CP failures.
      process.stderr.write('AI Worker could not reach its queue; retrying.\n');
      await pause(5000, signal);
    }
  }
}
