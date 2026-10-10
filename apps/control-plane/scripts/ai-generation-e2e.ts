/** Real PostgreSQL + Fastify acceptance in a disposable schema. No model charges. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';

const schema = `ai_e2e_${process.pid}`;
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
const { generationRoutes } = await import('../src/modules/generation/generation.routes.js');
const { testAuthoringRoutes } = await import(
  '../src/modules/test-authoring/test-authoring.routes.js'
);
const { runRoutes } = await import('../src/modules/run/run.routes.js');
const { signJwt } = await import('../src/shared/jwt.js');
const app = Fastify();
app.addHook('preHandler', authorizeControlPlaneRequest);
await aiGenerationRoutes(app);
await generationRoutes(app);
await testAuthoringRoutes(app);
await runRoutes(app);
const worker = {
  workerId: 'worker_a',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  harnessVersion: '0.85.1',
};
const worker2 = { ...worker, workerId: 'worker_b' };
const workerToken = process.env['AI_WORKER_TOKEN'];
function token(workspaceId: string) {
  return signJwt({
    sub: `usr_${workspaceId}`,
    email: `${workspaceId}@example.test`,
    displayName: 'Test',
    role: 'owner',
    workspaceId,
  });
}
async function request(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  auth = token('ws_a'),
  status = 200,
) {
  const response = await app.inject({
    method,
    url: path,
    headers: { authorization: `Bearer ${auth}` },
    ...(method === 'POST' ? { payload: body ?? {} } : {}),
  });
  assert.equal(response.statusCode, status, `${method} ${path}: ${response.body}`);
  return response.json();
}
const passed: string[] = [];
try {
  await runMigrations();
  await runMigrations();
  for (const ws of ['ws_a', 'ws_b']) {
    await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$1)', [ws]);
    await pool.query(
      "INSERT INTO users(id,workspace_id,email,password_hash,role) VALUES($1,$2,$3,'unused','owner')",
      [`usr_${ws}`, ws, `${ws}@example.test`],
    );
  }
  const source = {
    endpoints: [
      {
        id: 'health',
        method: 'GET',
        path: '/health',
        parameters: [],
        requestBodies: [],
        responses: [{ statusCode: 200 }],
        description: 'private prose',
        summary: 'private summary',
        example: 'private example',
      },
    ],
  };
  await pool.query(
    "INSERT INTO api_versions(id,workspace_id,source_type,source_location,content_hash,spec_json) VALUES('av_a','ws_a','openapi','test',$1,$2)",
    ['a'.repeat(64), JSON.stringify(source)],
  );
  await request('POST', '/api/ai-worker/heartbeat', worker, token('ws_a'), 401);
  await request('POST', '/api/ai-worker/heartbeat', worker, workerToken);
  await request('GET', '/api/generation-jobs', null, workerToken, 401);
  assert.equal((await request('GET', '/api/ai/capabilities', null)).available, true);
  assert.equal(
    (await request('GET', '/api/ai/capabilities', null, token('ws_b'))).available,
    false,
  );
  passed.push('Worker credential isolation and workspace capability');
  const enqueue = () =>
    request(
      'POST',
      '/api/generation-jobs',
      { workspaceId: 'ws_a', apiVersionId: 'av_a', strategy: 'pi', objective: 'Verify health' },
      undefined,
      201,
    );
  const job = await enqueue();
  await request('GET', `/api/generation-jobs/${job.id}`, null, token('ws_b'), 404);
  const claims = await Promise.all(
    [worker, worker2].map((w) => request('POST', '/api/ai-worker/claim', w, workerToken)),
  );
  assert.equal(claims.filter((c) => c.lease).length, 1);
  const lease = claims.find((c) => c.lease).lease;
  const owner = claims[0].lease ? worker : worker2;
  assert.equal(JSON.stringify(lease).includes('private'), false);
  passed.push('curated frozen input and concurrent single claim');
  await pool.query(
    "UPDATE ai_generation_tasks SET leased_until=now()-interval '1 second' WHERE job_id=$1",
    [job.id],
  );
  const reclaimed = (await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease;
  assert.equal(reclaimed.attempt, 2);
  assert.notEqual(reclaimed.leaseToken, lease.leaseToken);
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/heartbeat`,
    { workerId: owner.workerId, leaseToken: lease.leaseToken },
    workerToken,
    409,
  );
  passed.push('restart recovery and stale lease fencing');
  const result = {
    schemaVersion: reclaimed.task.schemaVersion,
    jobId: job.id,
    workspaceId: 'ws_a',
    apiVersionId: 'av_a',
    sourceHash: 'a'.repeat(64),
    inputHash: createHash('sha256').update(JSON.stringify(reclaimed.task)).digest('hex'),
    harness: 'pi-agent-core',
    harnessVersion: '0.85.1',
    promptVersion: '1.0.0',
    provider: worker.provider,
    model: worker.model,
    turns: 2,
    drafts: [
      {
        endpointId: 'health',
        status: 'pending',
        rationale: '200 is specified by the source.',
        definition: {
          schemaVersion: 'sketch-test.test/v1',
          id: 'health_test',
          name: 'Health contract',
          sideEffect: 'read-only',
          request: { method: 'GET', url: '${env.baseUrl}/health' },
          assertions: [{ id: 'status_ok', target: 'status', operator: 'equals', expected: 200 }],
        },
      },
    ],
  };
  const current = { workerId: worker.workerId, leaseToken: reclaimed.leaseToken };
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/complete`,
    { ...current, result: { ...result, inputHash: 'b'.repeat(64) } },
    workerToken,
    400,
  );
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/complete`,
    { ...current, result },
    workerToken,
  );
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/complete`,
    { ...current, result },
    workerToken,
  );
  const drafts = (await request('GET', `/api/generation-jobs/${job.id}/drafts`, null)).drafts;
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].confidence, null);
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/complete`,
    { ...current, result: { ...result, turns: 3 } },
    workerToken,
    409,
  );
  passed.push('provenance rejection and idempotent result transaction');
  const draftId = drafts[0].id;
  const race = await Promise.all(
    ['accept', 'reject'].map((action) =>
      app.inject({
        method: 'POST',
        url: `/api/drafts/${draftId}/${action}`,
        headers: { authorization: `Bearer ${token('ws_a')}` },
        payload: {},
      }),
    ),
  );
  assert.equal(race.filter((r) => r.statusCode === 409).length, 1);
  assert.equal(race.filter((r) => r.statusCode === 200 || r.statusCode === 201).length, 1);
  // If rejection won the race, create a second draft for the publication test.
  let versionId = race[0].statusCode === 201 ? race[0].json().versionId : undefined;
  if (!versionId) {
    await pool.query(
      "INSERT INTO generated_drafts(id,job_id,definition,source_info) SELECT 'second_draft',job_id,definition,source_info FROM generated_drafts WHERE id=$1",
      [draftId],
    );
    versionId = (await request('POST', '/api/drafts/second_draft/accept', {}, undefined, 201))
      .versionId;
  }
  const version = await pool.query('SELECT * FROM test_case_versions WHERE id=$1', [versionId]);
  assert.equal(version.rows[0].published_by, null);
  const published = await request('POST', `/api/test-case-versions/${versionId}/publish`, {
    publishedBy: 'spoofed',
  });
  assert.equal(published.published_by, 'usr_ws_a');
  const republished = await request('POST', `/api/test-case-versions/${versionId}/publish`, {});
  assert.equal(republished.published_at, published.published_at);
  const listed = await request('GET', '/api/test-cases?workspaceId=ws_a', null);
  assert.equal(listed.testCases[0].latestVersion.publishedBy, 'usr_ws_a');
  await pool.query(
    "INSERT INTO environments(id,workspace_id,name) VALUES('env_a','ws_a','Test'),('env_b','ws_b','Other')",
  );
  await pool.query(
    "INSERT INTO environment_versions(id,environment_id,version,base_url) VALUES('envv_a','env_a',1,'http://127.0.0.1:3800'),('envv_b','env_b',1,'http://127.0.0.1:3800')",
  );
  await request(
    'POST',
    `/api/test-case-versions/${versionId}/run`,
    { environmentVersionId: 'envv_b' },
    undefined,
    404,
  );
  await pool.query(
    `INSERT INTO environment_versions(id,environment_id,version,base_url,runner_labels,require_approval) VALUES
    ('envv_approval','env_a',2,'http://127.0.0.1:3800','[]',true),
    ('envv_labels','env_a',3,'http://127.0.0.1:3800','["private-network"]',false)`,
  );
  for (const environmentVersionId of ['envv_approval', 'envv_labels']) {
    await request(
      'POST',
      `/api/test-case-versions/${versionId}/run`,
      { environmentVersionId },
      undefined,
      409,
    );
  }
  const run = await request(
    'POST',
    `/api/test-case-versions/${versionId}/run`,
    { environmentVersionId: 'envv_a' },
    undefined,
    201,
  );
  const stored = (await pool.query('SELECT plan_json FROM runs WHERE id=$1', [run.runId])).rows[0]
    .plan_json;
  assert.equal(stored.environmentVersionId, 'envv_a');
  assert.equal(stored.steps[0].urlTemplate, 'http://127.0.0.1:3800/health');
  passed.push('published version readback and workspace-bound frozen environment execution');
  passed.push('concurrent review and explicit immutable publication');
  const cancelled = await enqueue();
  const cancelledLease = (await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease;
  await request('POST', `/api/generation-jobs/${cancelled.id}/cancel`, {});
  await request(
    'POST',
    `/api/ai-worker/jobs/${cancelled.id}/heartbeat`,
    { workerId: worker.workerId, leaseToken: cancelledLease.leaseToken },
    workerToken,
    409,
  );
  await request('POST', `/api/generation-jobs/${cancelled.id}/retry`, {});
  const retried = (await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease;
  assert.equal(retried.attempt, 2);
  await pool.query(
    "UPDATE ai_generation_tasks SET attempt=max_attempts,leased_until=now()-interval '1 second' WHERE job_id=$1",
    [cancelled.id],
  );
  assert.equal((await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease, null);
  assert.equal(
    (await request('GET', `/api/generation-jobs/${cancelled.id}`, null)).status,
    'failed',
  );
  passed.push('cancellation, retry and exhausted recovery');
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
