/** Disposable PostgreSQL/Fastify acceptance. Scripted Worker output, no model calls. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';

const schema = `plan_e2e_${process.pid}`;
const dbUrl =
  process.env['AI_E2E_DATABASE_URL'] ?? 'postgresql://localhost:5432/sketchtest_preview';
const admin = new pg.Pool({ connectionString: dbUrl });
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(dbUrl);
url.searchParams.set('options', `-c search_path=${schema}`);
process.env['DATABASE_URL'] = url.href;
process.env['AI_WORKER_TOKEN'] = randomUUID() + randomUUID();
process.env['AI_WORKER_WORKSPACE_ID'] = 'ws_a';
process.env['JWT_SECRET'] = randomUUID() + randomUUID();
const { pool, runMigrations } = await import('../src/db/db.js');
const { authorizeControlPlaneRequest } = await import(
  '../src/modules/iam/authorization.middleware.js'
);
const { aiGenerationRoutes } = await import('../src/modules/generation/ai-generation.routes.js');
const { planGenerationRoutes } = await import(
  '../src/modules/plan-generation/plan-generation.routes.js'
);
const { signJwt } = await import('../src/shared/jwt.js');
const app = Fastify();
app.addHook('preHandler', authorizeControlPlaneRequest);
await aiGenerationRoutes(app);
await planGenerationRoutes(app);
const worker = {
  workerId: 'w1',
  provider: 'test',
  model: 'test',
  harnessVersion: '0.85.1',
  capabilities: ['plan'],
};
const workerToken = process.env['AI_WORKER_TOKEN'];
function token(ws = 'ws_a') {
  return signJwt({
    sub: `u_${ws}`,
    workspaceId: ws,
    email: `${ws}@example.test`,
    displayName: 'Test',
    role: 'owner',
  });
}
async function req(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown = {},
  auth = token(),
  status = 200,
) {
  const r = await app.inject({
    method,
    url: path,
    headers: { authorization: `Bearer ${auth}` },
    ...(method !== 'GET' ? { payload: body } : {}),
  });
  assert.equal(r.statusCode, status, `${method} ${path}: ${r.body}`);
  return r.json();
}
const passed: string[] = [];
try {
  await runMigrations();
  await runMigrations();
  for (const ws of ['ws_a', 'ws_b']) {
    await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$1)', [ws]);
    await pool.query(
      "INSERT INTO users(id,workspace_id,email,password_hash,role) VALUES($1,$2,$3,'unused','owner')",
      [`u_${ws}`, ws, `${ws}@example.test`],
    );
  }
  await pool.query(
    "INSERT INTO api_versions(id,workspace_id,source_type,source_location,content_hash,spec_json) VALUES('av1','ws_a','openapi','source',$1,'{}')",
    ['a'.repeat(64)],
  );
  await pool.query(
    "INSERT INTO test_cases(id,workspace_id,api_version_id,name) VALUES('tc1','ws_a','av1','Health')",
  );
  await pool.query(
    `INSERT INTO test_case_versions(id,test_case_id,version,definition,published_by) VALUES('tv1','tc1',1,$1,'u_ws_a')`,
    [
      JSON.stringify({
        request: {
          method: 'GET',
          url: '${env.baseUrl}/health?token=never-share',
          headers: { Authorization: 'private-value' },
          body: 'private-body',
        },
      }),
    ],
  );
  await pool.query(
    "INSERT INTO generation_jobs(id,workspace_id,api_version_id) VALUES('g1','ws_a','av1')",
  );
  await pool.query(
    `INSERT INTO generated_drafts(id,job_id,definition,source_info) VALUES('d1','g1',$1,$2)`,
    [
      JSON.stringify({ name: 'Health draft', sideEffect: 'read-only' }),
      JSON.stringify({ method: 'GET', path: '/health' }),
    ],
  );
  await req('POST', '/api/ai-worker/heartbeat', worker, workerToken);
  await req('POST', '/api/ai-worker/plans/claim', worker, token(), 401);
  await req('PUT', '/api/plan-suggestions/settings', { enabled: true });
  const lease = (await req('POST', '/api/ai-worker/plans/claim', worker, workerToken)).lease;
  assert(lease);
  assert(!JSON.stringify(lease.task).includes('private-'));
  assert(!JSON.stringify(lease.task).includes('never-share'));
  assert.equal((await req('GET', '/api/plan-suggestions', {}, token('ws_b'))).jobs.length, 0);
  assert.equal((await req('POST', '/api/ai-worker/plans/claim', worker, workerToken)).lease, null);
  passed.push(
    'automatic snapshot generation, deduplication, curated input and workspace isolation',
  );
  const proposal = {
    name: 'Health plan',
    objective: 'Health regression',
    explanation: 'Published evidence',
    members: [{ key: 'tc1', reason: 'published' }],
    gaps: [{ key: 'd1', reason: 'pending' }],
    noNewFailures: true,
    blockOnInfraError: true,
    precautions: [],
  };
  const result = {
    schemaVersion: lease.task.schemaVersion,
    jobId: lease.task.jobId,
    workspaceId: 'ws_a',
    sourceHash: lease.task.sourceHash,
    inputHash: createHash('sha256').update(JSON.stringify(lease.task)).digest('hex'),
    provider: 'test',
    model: 'test',
    proposal,
  };
  const envelope = { workerId: worker.workerId, leaseToken: lease.leaseToken };
  const base = `/api/ai-worker/plans/${lease.task.jobId}`;
  await req(
    'POST',
    `${base}/complete`,
    { ...envelope, leaseToken: randomUUID(), result },
    workerToken,
    409,
  );
  await req(
    'POST',
    `${base}/complete`,
    {
      ...envelope,
      result: { ...result, proposal: { ...proposal, members: [{ key: 'd1', reason: 'bad' }] } },
    },
    workerToken,
    400,
  );
  await req('POST', `${base}/complete`, { ...envelope, result }, workerToken);
  await req('POST', `${base}/complete`, { ...envelope, result }, workerToken);
  await req('POST', `${base}/fail`, envelope, workerToken, 409);
  passed.push('fenced completion, draft exclusion, idempotent replay and late-failure rejection');
  const path = `/api/plan-suggestions/${lease.task.jobId}`;
  await req('POST', `${path}/save`, { revision: 1, proposal }, token('ws_b'), 404);
  await req('POST', `${path}/publish`, { revision: 1 }, token(), 409);
  await req('POST', `${path}/save`, { revision: 1, proposal });
  await req('POST', `${path}/save`, { revision: 1, proposal }, token(), 409);
  assert.equal(Number((await pool.query('SELECT count(*) FROM test_suites')).rows[0].count), 0);
  passed.push('optimistic draft save without publication');
  const published = await req('POST', `${path}/publish`, { revision: 2 });
  assert(published.suiteId);
  const members = (
    await pool.query('SELECT members_json FROM test_suite_versions WHERE test_suite_id=$1', [
      published.suiteId,
    ])
  ).rows[0].members_json;
  assert.deepEqual(members, [{ type: 'test', id: 'tc1' }]);
  assert.equal((await req('POST', `${path}/publish`, { revision: 2 })).suiteId, published.suiteId);
  assert.equal(Number((await pool.query('SELECT count(*) FROM runs')).rows[0].count), 0);
  passed.push('atomic independent publication, excludes pending drafts, never runs');
  await pool.query("UPDATE users SET role='viewer' WHERE id='u_ws_b'");
  await req('PUT', '/api/plan-suggestions/settings', { enabled: true }, token('ws_b'), 403);
  passed.push('viewer cannot enable or mutate suggestions');
  console.log(JSON.stringify({ ok: true, passed }, null, 2));
} finally {
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
