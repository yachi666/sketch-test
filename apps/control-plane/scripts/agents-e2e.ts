/** Real PostgreSQL + Fastify acceptance in a disposable schema. No model charges. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';

const schema = `agent_e2e_${process.pid}`;
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
const { agentsRoutes } = await import('../src/modules/agents/agents.routes.js');
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
await agentsRoutes(app);
await generationRoutes(app);
await testAuthoringRoutes(app);
await runRoutes(app);
const worker = {
  agentConfigVersion: 1 as const,
  connectionRef: 'default',
  workerId: 'worker_a',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  harnessVersion: '0.85.1',
};
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
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown,
  auth = token('ws_a'),
  status = 200,
) {
  const response = await app.inject({
    method,
    url: path,
    headers: { authorization: `Bearer ${auth}` },
    ...(method !== 'GET' ? { payload: body ?? {} } : {}),
  });
  assert.equal(response.statusCode, status, `${method} ${path}: ${response.body}`);
  return response.json();
}
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
  await request('POST', '/api/ai-worker/heartbeat', worker, workerToken);
  const c = (
    await request(
      'POST',
      '/api/provider-connections',
      { name: 'DeepSeek', provider: 'deepseek', connectionRef: 'default' },
      undefined,
      201,
    )
  ).connection;
  await request(
    'POST',
    '/api/provider-connections',
    { name: 'Duplicate', provider: 'deepseek', connectionRef: 'default' },
    undefined,
    409,
  );
  const config = {
    name: '契约 Agent',
    avatar: 'contract',
    capability: 'test',
    enabled: true,
    connectionId: c.id,
    model: worker.model,
    instructions: '仅生成有证据的草稿',
    timeoutMs: 60000,
    retries: 1,
    maxOutputTokens: 1024,
  };
  const agent = (await request('POST', '/api/agents', config, undefined, 201)).agent;
  const glm = {
    ...worker,
    workerId: 'glm_worker',
    provider: 'zai',
    model: 'glm-4.7',
    connectionRef: 'glm-team',
  };
  await request('POST', '/api/ai-worker/heartbeat', glm, workerToken);
  const glmConnection = (
    await request(
      'POST',
      '/api/provider-connections',
      { name: 'GLM team', provider: 'zai', connectionRef: 'glm-team' },
      undefined,
      201,
    )
  ).connection;
  const glmAgent = (
    await request(
      'POST',
      '/api/agents',
      { ...config, name: 'GLM Agent', connectionId: glmConnection.id, model: glm.model },
      undefined,
      201,
    )
  ).agent;
  const glmJob = await request(
    'POST',
    '/api/generation-jobs',
    {
      workspaceId: 'ws_a',
      apiVersionId: 'av_a',
      strategy: 'pi',
      objective: 'Check health',
      agentId: glmAgent.id,
    },
    undefined,
    201,
  );
  assert.equal((await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease, null);
  const glmLease = (await request('POST', '/api/ai-worker/claim', glm, workerToken)).lease;
  assert.equal(glmLease.task.agent.provider, 'zai');
  assert.equal(glmLease.task.jobId, glmJob.id);
  await request('POST', `/api/generation-jobs/${glmJob.id}/cancel`, {});

  await request('POST', '/api/agents', config, token('ws_b'), 404);
  await request('GET', `/api/agents/${agent.id}/versions`, null, token('ws_b'), 404);
  await request('PUT', `/api/agents/${agent.id}`, { config, expectedVersion: 99 }, undefined, 409);
  const create = {
    workspaceId: 'ws_a',
    apiVersionId: 'av_a',
    strategy: 'pi',
    objective: 'Verify health',
    agentId: agent.id,
  };
  await request('POST', '/api/generation-jobs', { ...create, agentId: undefined }, undefined, 400);
  const job = await request('POST', '/api/generation-jobs', create, undefined, 201);
  const updated = (
    await request('PUT', `/api/agents/${agent.id}`, {
      config: { ...config, name: 'Updated', enabled: false },
      expectedVersion: 1,
    })
  ).agent;
  assert.equal(updated.version, 2);
  await request('POST', '/api/generation-jobs', create, undefined, 409);
  assert.equal(
    (
      await request(
        'POST',
        '/api/ai-worker/claim',
        { ...worker, workerId: 'wrong_ref', connectionRef: 'other' },
        workerToken,
      )
    ).lease,
    null,
  );
  assert.equal(
    (
      await request(
        'POST',
        '/api/ai-worker/claim',
        { ...worker, workerId: 'legacy', agentConfigVersion: undefined },
        workerToken,
      )
    ).lease,
    null,
  );
  const lease = (await request('POST', '/api/ai-worker/claim', worker, workerToken)).lease;
  assert.equal(lease.task.agent.version, 1);
  assert.equal(lease.task.agent.name, config.name);
  assert.equal(lease.task.limits.maxOutputTokens, 1024);
  const definition = {
    schemaVersion: 'sketch-test.test/v1',
    id: 'health_test',
    name: 'Original',
    sideEffect: 'read-only',
    request: { method: 'GET', url: '${env.baseUrl}/health' },
    assertions: [{ id: 'ok', target: 'status', operator: 'equals', expected: 200 }],
  };
  const result = {
    schemaVersion: lease.task.schemaVersion,
    jobId: job.id,
    workspaceId: 'ws_a',
    apiVersionId: 'av_a',
    sourceHash: 'a'.repeat(64),
    inputHash: createHash('sha256').update(JSON.stringify(lease.task)).digest('hex'),
    harness: 'pi-agent-core',
    harnessVersion: '1.1.0',
    promptVersion: '1.1.0',
    provider: worker.provider,
    model: worker.model,
    turns: 2,
    events: [
      {
        type: 'model.completed',
        at: new Date().toISOString(),
        success: true,
        inputTokens: 100,
        outputTokens: 50,
      },
    ],
    drafts: [{ endpointId: 'health', status: 'pending', rationale: 'Source 200', definition }],
  };
  const envelope = { workerId: worker.workerId, leaseToken: lease.leaseToken, result };
  await request(
    'POST',
    `/api/ai-worker/jobs/${job.id}/complete`,
    { ...envelope, result: { ...result, model: 'wrong' } },
    workerToken,
    400,
  );
  await request('POST', `/api/ai-worker/jobs/${job.id}/complete`, envelope, workerToken);
  const before = await request('GET', `/api/generation-jobs/${job.id}/execution`, null);
  await request('POST', `/api/ai-worker/jobs/${job.id}/complete`, envelope, workerToken);
  const execution = await request('GET', `/api/generation-jobs/${job.id}/execution`, null);
  assert.equal(execution.events.length, before.events.length);
  assert.equal(execution.outputs.length, 1);
  await request('GET', `/api/generation-jobs/${job.id}/execution`, null, token('ws_b'), 404);
  const draft = execution.outputs[0];
  const accepted = await request(
    'POST',
    `/api/drafts/${draft.id}/accept`,
    { modifications: { ...definition, name: 'Human correction' } },
    undefined,
    201,
  );
  const after = await request('GET', `/api/generation-jobs/${job.id}/execution`, null);
  assert.equal(after.outputs[0].originalDefinition.name, 'Original');
  assert.equal(after.agent.version, 1);
  const provenance = (
    await request('GET', `/api/test-cases/${accepted.testCaseId}/provenance`, null)
  ).sources[0];
  assert.equal(provenance.jobId, job.id);
  assert.equal(provenance.sourceInfo.agentVersion, 1);
  await request(
    'GET',
    `/api/test-cases/${accepted.testCaseId}/provenance`,
    null,
    token('ws_b'),
    404,
  );
  const history = (await request('GET', `/api/agents/${agent.id}/versions`, null)).versions;
  assert.deepEqual(
    history.map((v: { config: { version: number } }) => v.config.version),
    [2, 1],
  );
  await assert.rejects(
    pool.query('UPDATE agent_versions SET config=config WHERE agent_id=$1', [agent.id]),
    /immutable/,
  );
  const check = await request('POST', `/api/provider-connections/${c.id}/check`, {});
  assert.equal(check.available, true);
  console.log(
    JSON.stringify(
      {
        passed: [
          'workspace isolation',
          'immutable versions and optimistic concurrency',
          'explicit Agent selection',
          'disabled Agent rejection',
          'frozen config survives updates',
          'connection and protocol routing',
          'model mismatch rejection',
          'idempotent completion and telemetry',
          'original output survives review modifications',
          'case provenance',
          'connection readiness',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
