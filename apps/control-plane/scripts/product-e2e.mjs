import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  CreateBucketCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const suffix = `${process.pid}-${Date.now()}`;
const database = `sketchtest_e2e_${process.pid}`;
const restoredDatabase = `${database}_restored`;
const container = `sketchtest-e2e-minio-${suffix}`;
const postgresContainer = `sketchtest-e2e-postgres-${suffix}`;
const bucket = `sketchtest-e2e-${process.pid}`;
const restoredBucket = `${bucket}-restored`;
const databaseBackup = path.join(tmpdir(), `${database}.dump`);
const accessKey = 'e2e-access';
const secretKey = 'e2e-secret-password';
const secret32 = '0123456789abcdef0123456789abcdef';
const postgresPassword = 'product-e2e-postgres-password';
const managedPostgres = process.env['E2E_MANAGED_POSTGRES'] === '1';
const children = [];
let containerStarted = false;
let postgresContainerStarted = false;
let postgresPort;
let databaseCreated = false;
let restoredDatabaseCreated = false;

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args.join(' ')} failed (${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function postgresCommand(program, args, options = {}) {
  if (!managedPostgres) return command(program, args, options);
  return command(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${postgresPassword}`,
      postgresContainer,
      program,
      '-U',
      'postgres',
      ...args,
    ],
    options,
  );
}

function databaseUrl(name) {
  if (!managedPostgres) return `postgresql:///${name}`;
  if (!postgresPort) throw new Error('Managed PostgreSQL port is not initialized');
  return `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/${name}`;
}

async function startManagedPostgres() {
  postgresPort = await freePort();
  command('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    postgresContainer,
    '-p',
    `127.0.0.1:${postgresPort}:5432`,
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    '-e',
    'POSTGRES_DB=postgres',
    'postgres:18-alpine',
  ]);
  postgresContainerStarted = true;

  const deadline = Date.now() + 60_000;
  let consecutiveReadyChecks = 0;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${postgresPassword}`,
        postgresContainer,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--tuples-only',
        '--no-align',
        '--command',
        'SELECT 1',
      ],
      { cwd: repoRoot, stdio: 'ignore' },
    );
    consecutiveReadyChecks = result.status === 0 ? consecutiveReadyChecks + 1 : 0;
    if (consecutiveReadyChecks >= 3) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for managed PostgreSQL 18');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Cannot allocate port'));
      server.close(() => resolve(address.port));
    });
  });
}

function start(name, program, args, options) {
  const child = spawn(program, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      logs.push(text);
      if (process.env['E2E_VERBOSE'] === '1') process.stderr.write(`[${name}] ${text}`);
    });
  }
  child.e2eName = name;
  child.e2eLogs = logs;
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${options.method ?? 'GET'} ${url}: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function cleanup() {
  for (const child of [...children].reverse()) await stopChild(child);
  if (containerStarted) {
    spawnSync('docker', ['rm', '-f', container], { cwd: repoRoot, stdio: 'ignore' });
  }
  if (postgresContainerStarted) {
    spawnSync('docker', ['rm', '-f', postgresContainer], { cwd: repoRoot, stdio: 'ignore' });
  } else {
    if (databaseCreated) {
      spawnSync('dropdb', ['--if-exists', database], { cwd: repoRoot, stdio: 'ignore' });
    }
    if (restoredDatabaseCreated) {
      spawnSync('dropdb', ['--if-exists', restoredDatabase], { cwd: repoRoot, stdio: 'ignore' });
    }
  }
  if (existsSync(databaseBackup)) unlinkSync(databaseBackup);
}

async function main() {
  const minioImage = 'sketchtest/minio:RELEASE.2025-09-07T16-13-09Z';
  command('docker', ['build', '--target', 'server', '-t', minioImage, 'ops/minio']);
  command('docker', ['version'], { capture: true });
  if (managedPostgres) {
    await startManagedPostgres();
  } else {
    command('pg_isready', [], { capture: true });
  }
  postgresCommand('dropdb', ['--if-exists', database], { capture: true });
  postgresCommand('createdb', [database]);
  databaseCreated = true;

  const [fixturePort, controlPlanePort, minioPort, consolePort, webPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
  const controlPlaneUrl = `http://127.0.0.1:${controlPlanePort}`;
  const minioUrl = `http://127.0.0.1:${minioPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  // Build the current worktree, then rebuild Web with the temporary Control Plane URL embedded in
  // its production bundle. `vite preview` cannot read VITE_CP_BASE at server start.
  command('pnpm', ['build', '--force']);
  command('pnpm', ['--filter', 'web', 'build'], {
    env: { ...process.env, VITE_CP_BASE: controlPlaneUrl },
  });

  command('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    container,
    '-p',
    `127.0.0.1:${minioPort}:9000`,
    '-p',
    `127.0.0.1:${consolePort}:9001`,
    '-e',
    `MINIO_ROOT_USER=${accessKey}`,
    '-e',
    `MINIO_ROOT_PASSWORD=${secretKey}`,
    minioImage,
    'server',
    '/data',
    '--console-address',
    ':9001',
  ]);
  containerStarted = true;
  await waitFor(`${minioUrl}/minio/health/live`, 60_000);

  const s3 = new S3Client({
    endpoint: minioUrl,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));

  start('fixture', process.execPath, ['--no-strip-types', 'dist/index.js'], {
    cwd: path.join(repoRoot, 'packages/test-fixtures/hermetic-fixture-server'),
    env: { FIXTURE_PORT: String(fixturePort) },
  });
  await waitFor(`${fixtureUrl}/health`);

  start('control-plane', 'node', ['--no-strip-types', 'dist/main.js'], {
    cwd: path.join(repoRoot, 'apps/control-plane'),
    env: {
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl(database),
      CP_HOST: '127.0.0.1',
      CP_PORT: String(controlPlanePort),
      LOG_LEVEL: 'warn',
      JWT_SECRET: secret32,
      SECRET_KEY: secret32,
      RUNNER_REGISTRATION_TOKEN: secret32,
      S3_ENDPOINT: minioUrl,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY: accessKey,
      S3_SECRET_KEY: secretKey,
      S3_BUCKET: bucket,
      EVIDENCE_INLINE_MAX_BYTES: '200',
      WEB_ORIGINS: webUrl,
      IMPORT_ALLOWED_HOSTS: `127.0.0.1:${fixturePort}`,
    },
  });
  await waitFor(`${controlPlaneUrl}/health`);
  start(
    'web',
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(webPort)],
    {
      cwd: path.join(repoRoot, 'apps/web'),
      env: { VITE_CP_BASE: controlPlaneUrl },
    },
  );
  await waitFor(webUrl);
  const ready = await json(`${controlPlaneUrl}/ready`);
  assert(ready.status === 'ready', 'readiness must include PostgreSQL and S3');
  const correlatedHealth = await fetch(`${controlPlaneUrl}/health/live`, {
    headers: { 'x-request-id': 'product-e2e-health' },
  });
  assert(
    correlatedHealth.headers.get('x-request-id') === 'product-e2e-health',
    'Control Plane must propagate request IDs',
  );

  const workspaceResult = await json(`${controlPlaneUrl}/api/workspaces`, {
    method: 'POST',
    body: {
      name: `Product E2E ${suffix}`,
      ownerEmail: 'owner@product-e2e.test',
      ownerPassword: 'product-e2e-owner-password',
    },
  });
  const workspaceId = workspaceResult.workspace.id;
  const login = await json(`${controlPlaneUrl}/api/auth/login`, {
    method: 'POST',
    body: {
      workspaceId,
      email: 'owner@product-e2e.test',
      password: 'product-e2e-owner-password',
    },
  });
  const userHeaders = { authorization: `Bearer ${login.token}` };
  const secret = await json(`${controlPlaneUrl}/api/secrets`, {
    method: 'POST',
    headers: userHeaders,
    body: { workspaceId, name: 'e2e-api-key', value: 'never-log-this-value' },
  });
  const registration = await json(`${controlPlaneUrl}/api/runners/register`, {
    method: 'POST',
    headers: { 'x-runner-registration-token': secret32 },
    body: { workspaceId, name: 'product-e2e-runner', version: 'e2e' },
  });
  const decrypted = await json(`${controlPlaneUrl}/api/secrets/${secret.id}/decrypt`, {
    method: 'POST',
    headers: {
      'x-runner-token': registration.token,
      'x-request-id': 'product-e2e-secret-decrypt',
    },
  });
  assert(decrypted.value === 'never-log-this-value', 'runner secret channel must decrypt');
  const audit = await json(
    `${controlPlaneUrl}/api/audit-logs?workspaceId=${encodeURIComponent(workspaceId)}&action=secret.decrypt`,
    { headers: userHeaders },
  );
  assert(audit.events.length === 1, 'secret decryption must create one audit event');
  assert(
    audit.events[0].requestId === 'product-e2e-secret-decrypt',
    'audit evidence must retain request correlation',
  );
  start('runner', 'node', ['--no-strip-types', 'dist/daemon.js'], {
    cwd: path.join(repoRoot, 'apps/runner'),
    env: {
      NODE_ENV: 'production',
      CP_URL: controlPlaneUrl,
      WORKSPACE_ID: workspaceId,
      RUNNER_ID: registration.id,
      RUNNER_TOKEN: registration.token,
    },
  });

  const imported = await json(`${controlPlaneUrl}/api/import`, {
    method: 'POST',
    headers: userHeaders,
    body: { sourceType: 'url', sourceLocation: `${fixtureUrl}/openapi.json` },
  });
  assert(imported.endpointCount > 0, 'import must produce endpoints');
  assert(imported.sourceObjectKey.startsWith('api-sources/sha256/'), 'raw source must be durable');

  const arazzoSource = `arazzo: 1.1.0
info:
  title: Cross-process OpenAPI 3.2 QUERY
  version: 1.0.0
sourceDescriptions:
  - name: fixture
    url: ${fixtureUrl}/openapi.json
    type: openapi
workflows:
  - workflowId: searchFlow
    summary: Execute a structured search through OpenAPI 3.2 QUERY
    steps:
      - stepId: search
        operationId: $sourceDescriptions.fixture.searchUsers
        requestBody:
          contentType: application/json
          payload:
            term: 测试
        successCriteria:
          - condition: $statusCode == 200
`;
  const importedWorkflow = await json(`${controlPlaneUrl}/api/workflows/import/arazzo`, {
    method: 'POST',
    headers: userHeaders,
    body: {
      sourceText: arazzoSource,
      sourceLocation: `${fixtureUrl}/workflows/search.arazzo.yaml`,
      sources: { fixture: imported.apiVersionId },
    },
  });
  assert(importedWorkflow.workflows.length === 1, 'Arazzo import must create one workflow');
  assert(
    importedWorkflow.sourceObjectKey.startsWith('workflow-sources/sha256/'),
    'raw Arazzo source must be durable',
  );
  const workflowVersionId = importedWorkflow.workflows[0].workflowVersionId;
  const published = await json(
    `${controlPlaneUrl}/api/workflow-versions/${workflowVersionId}/publish`,
    { method: 'POST', headers: userHeaders, body: { publishedBy: 'product-e2e' } },
  );
  assert(published.published === true, 'workflow must publish');
  assert(/^[a-f0-9]{64}$/.test(published.plan.planHash), 'plan hash must be SHA-256');

  const createdRun = await json(`${controlPlaneUrl}/api/runs/from-workflow`, {
    method: 'POST',
    headers: userHeaders,
    body: { workflowVersionId },
  });
  const runId = createdRun.runId;
  const deadline = Date.now() + 60_000;
  let run;
  while (Date.now() < deadline) {
    run = await json(`${controlPlaneUrl}/api/runs/${runId}`, { headers: userHeaders });
    if (['passed', 'failed', 'cancelled', 'lost'].includes(run.run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(run?.run.status === 'passed', `run must pass, received ${run?.run.status ?? 'timeout'}`);
  assert(run.steps.length >= 6, 'runner must upload ordered execution evidence');

  const report = await json(`${controlPlaneUrl}/api/runs/${runId}/report`, {
    headers: userHeaders,
  });
  assert(report.run.workflowVersionId === workflowVersionId, 'report must retain provenance');
  assert(report.steps[0]?.status === 'passed', 'report step must pass');
  const traceIds = new Set(
    report.steps.flatMap((step) => step.events.map((event) => event.payload.traceId)),
  );
  assert(traceIds.size === 1, 'all execution evidence must share one trace ID');
  const traceId = [...traceIds][0];
  assert(/^[a-f0-9]{32}$/.test(traceId), 'trace ID must be W3C-compatible');
  const preparedEvent = report.steps[0].events.find(
    (event) => event.eventType === 'request.prepared',
  );
  assert(
    preparedEvent.payload.headers.traceparent.startsWith(`00-${traceId}-`),
    'HTTP request traceparent must correlate with evidence',
  );
  const cliStatus = JSON.parse(
    command(
      'node',
      [
        'apps/cli/dist/index.js',
        'status',
        runId,
        '--cp-url',
        controlPlaneUrl,
        '--token',
        login.token,
        '--output',
        'json',
      ],
      { capture: true },
    ),
  );
  assert(cliStatus.id === runId && cliStatus.status === 'passed', 'CLI must read real run status');
  const manifest = await json(`${controlPlaneUrl}/api/runs/${runId}/evidence-manifest`, {
    headers: userHeaders,
  });
  assert(manifest.eventCount === run.steps.length, 'manifest must cover every stored event');
  assert(/^[a-f0-9]{64}$/.test(manifest.manifestHash), 'manifest hash must be SHA-256');
  const externalEvents = manifest.events.filter((event) => event.objectKey);
  assert(externalEvents.length > 0, 'large event payloads must be externalized');

  const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  const keys = new Set((objects.Contents ?? []).map((object) => object.Key));
  assert(keys.has(imported.sourceObjectKey), 'S3 must contain imported raw source');
  assert(keys.has(manifest.objectKey), 'S3 must contain immutable evidence manifest');
  for (const event of externalEvents) {
    assert(keys.has(event.objectKey), `S3 must contain external event ${event.id}`);
  }

  await s3.send(new CreateBucketCommand({ Bucket: restoredBucket }));
  for (const key of keys) {
    const sourceObject = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const sourceBody = await sourceObject.Body.transformToByteArray();
    await s3.send(new PutObjectCommand({ Bucket: restoredBucket, Key: key, Body: sourceBody }));
    const restoredObject = await s3.send(
      new GetObjectCommand({ Bucket: restoredBucket, Key: key }),
    );
    const restoredBody = await restoredObject.Body.transformToByteArray();
    assert(
      createHash('sha256').update(sourceBody).digest('hex') ===
        createHash('sha256').update(restoredBody).digest('hex'),
      `restored S3 object must match ${key}`,
    );
  }
  const restoredObjects = await s3.send(new ListObjectsV2Command({ Bucket: restoredBucket }));
  const restoredKeys = new Set((restoredObjects.Contents ?? []).map((object) => object.Key));
  assert(restoredKeys.size === keys.size, 'restored S3 bucket must contain every evidence object');

  const databaseBackupPath = managedPostgres ? `/tmp/${database}.dump` : databaseBackup;
  postgresCommand('pg_dump', ['--format=custom', '--file', databaseBackupPath, database]);
  postgresCommand('dropdb', ['--if-exists', restoredDatabase], { capture: true });
  postgresCommand('createdb', [restoredDatabase]);
  restoredDatabaseCreated = true;
  postgresCommand('pg_restore', [
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname',
    restoredDatabase,
    databaseBackupPath,
  ]);
  const restoredRunStatus = postgresCommand(
    'psql',
    [
      '--tuples-only',
      '--no-align',
      '--dbname',
      restoredDatabase,
      '--command',
      `SELECT status FROM runs WHERE id = '${runId}'`,
    ],
    { capture: true },
  );
  const restoredMigrationCount = Number(
    postgresCommand(
      'psql',
      [
        '--tuples-only',
        '--no-align',
        '--dbname',
        restoredDatabase,
        '--command',
        'SELECT COUNT(*) FROM schema_migrations',
      ],
      { capture: true },
    ),
  );
  assert(restoredRunStatus === 'passed', 'restored PostgreSQL must retain the completed run');
  assert(restoredMigrationCount > 0, 'restored PostgreSQL must retain migration history');

  const metricsResponse = await fetch(`${controlPlaneUrl}/metrics`);
  const metrics = await metricsResponse.text();
  assert(
    metrics.includes('sketchtest_http_requests_total') && metrics.includes('route="/api/runs/:id"'),
    'Prometheus metrics must contain normalized route counters',
  );
  command('pnpm', ['--filter', 'web', 'e2e:live'], {
    env: {
      ...process.env,
      E2E_WEB_URL: webUrl,
      E2E_CP_URL: controlPlaneUrl,
      E2E_RUN_ID: runId,
      E2E_WORKSPACE_ID: workspaceId,
      E2E_OWNER_EMAIL: 'owner@product-e2e.test',
      E2E_OWNER_PASSWORD: 'product-e2e-owner-password',
      E2E_FIXTURE_URL: fixtureUrl,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiVersionId: imported.apiVersionId,
        endpointCount: imported.endpointCount,
        workflowVersionId,
        planHash: published.plan.planHash,
        runId,
        eventCount: manifest.eventCount,
        externalizedEventCount: externalEvents.length,
        manifestHash: manifest.manifestHash,
        traceId,
        auditEventId: audit.events[0].id,
        recovery: {
          databaseRunStatus: restoredRunStatus,
          migrationCount: restoredMigrationCount,
          objectCount: restoredKeys.size,
        },
        objectKeys: [...keys].sort(),
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  for (const child of children) {
    const logs = child.e2eLogs?.join('').trim();
    if (logs) console.error(`\n--- ${child.e2eName} ---\n${logs}`);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
