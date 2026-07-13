import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const suffix = `${process.pid}-${Date.now()}`;
const projectName = `sketchtest-smoke-${suffix}`;
const version = `smoke-${suffix}`;
const secret32 = '0123456789abcdef0123456789abcdef';
const ownerEmail = 'owner@compose-smoke.test';
const ownerPassword = 'compose-smoke-owner-password';
const imageNames = [
  `sketchtest/control-plane:${version}`,
  `sketchtest/web:${version}`,
  `sketchtest/runner:${version}`,
];

let composeEnvironment;
let composeStarted = false;

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args.join(' ')} failed (${result.status})\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result.stdout?.trim() ?? '';
}

function compose(args, options = {}) {
  return command(
    'docker',
    ['compose', '--project-name', projectName, '--profile', 'runner', ...args],
    { ...options, env: composeEnvironment },
  );
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

async function waitFor(url, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${url}: HTTP ${response.status} ${responseText}`);
  }
  return responseText ? JSON.parse(responseText) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Compose smoke assertion failed: ${message}`);
}

async function waitForRunnerHeartbeat(controlPlaneUrl, workspaceId, runnerId, token) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await requestJson(
        `${controlPlaneUrl}/api/runners?workspaceId=${encodeURIComponent(workspaceId)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const runner = result.runners.find((candidate) => candidate.id === runnerId);
      if (runner?.lastHeartbeat) return runner;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for Runner ${runnerId} heartbeat${detail}`);
}

async function cleanup() {
  if (composeStarted) {
    spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        projectName,
        '--profile',
        'runner',
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      { cwd: repoRoot, env: composeEnvironment, stdio: 'ignore' },
    );
  }
  spawnSync('docker', ['image', 'rm', '--force', ...imageNames], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}

async function main() {
  command('docker', ['version'], { capture: true });
  command('docker', ['compose', 'version'], { capture: true });

  const [controlPlanePort, webPort, minioConsolePort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const controlPlaneUrl = `http://127.0.0.1:${controlPlanePort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;

  composeEnvironment = {
    ...process.env,
    SKETCHTEST_VERSION: version,
    POSTGRES_PASSWORD: 'compose-smoke-postgres-password',
    JWT_SECRET: secret32,
    SECRET_KEY: secret32,
    RUNNER_REGISTRATION_TOKEN: secret32,
    S3_ACCESS_KEY: 'compose-smoke-access',
    S3_SECRET_KEY: 'compose-smoke-secret-password',
    S3_BUCKET: `compose-smoke-${process.pid}`,
    CP_PORT: String(controlPlanePort),
    WEB_PORT: String(webPort),
    MINIO_CONSOLE_PORT: String(minioConsolePort),
    WEB_ORIGINS: webUrl,
    PUBLIC_CONTROL_PLANE_URL: controlPlaneUrl,
    LOG_LEVEL: 'warn',
  };

  compose(['config', '--quiet']);
  composeStarted = true;
  compose(['up', '--detach', '--build', 'postgres', 'minio', 'minio-init', 'control-plane', 'web']);

  await waitFor(`${controlPlaneUrl}/ready`);
  await waitFor(`${webUrl}/health/live`);

  const workspaceResult = await requestJson(`${controlPlaneUrl}/api/workspaces`, {
    method: 'POST',
    body: {
      name: `Compose smoke ${suffix}`,
      ownerEmail,
      ownerPassword,
    },
  });
  const workspaceId = workspaceResult.workspace.id;

  const login = await requestJson(`${controlPlaneUrl}/api/auth/login`, {
    method: 'POST',
    body: { workspaceId, email: ownerEmail, password: ownerPassword },
  });
  const registration = await requestJson(`${controlPlaneUrl}/api/runners/register`, {
    method: 'POST',
    headers: { 'x-runner-registration-token': secret32 },
    body: { workspaceId, name: 'compose-smoke-runner', version },
  });

  composeEnvironment = {
    ...composeEnvironment,
    WORKSPACE_ID: workspaceId,
    RUNNER_ID: registration.id,
    RUNNER_TOKEN: registration.token,
  };
  compose(['up', '--detach', '--build', '--no-deps', 'runner']);
  await waitFor(`${controlPlaneUrl}/ready`);

  const runner = await waitForRunnerHeartbeat(
    controlPlaneUrl,
    workspaceId,
    registration.id,
    login.token,
  );
  const runningServices = compose(['ps', '--status', 'running', '--services'], {
    capture: true,
  }).split('\n');

  for (const service of ['postgres', 'minio', 'control-plane', 'web', 'runner']) {
    assert(runningServices.includes(service), `${service} must be running`);
  }
  assert(runner.status === 'online', 'Runner must report online after heartbeat');

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectName,
        workspaceId,
        runnerId: registration.id,
        runnerHeartbeat: runner.lastHeartbeat,
        services: runningServices.sort(),
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
  if (composeStarted) {
    const logs = spawnSync(
      'docker',
      [
        'compose',
        '--project-name',
        projectName,
        '--profile',
        'runner',
        'logs',
        '--no-color',
        '--tail',
        '200',
      ],
      { cwd: repoRoot, env: composeEnvironment, encoding: 'utf8' },
    );
    if (logs.stdout) console.error(logs.stdout);
    if (logs.stderr) console.error(logs.stderr);
  }
  process.exitCode = 1;
} finally {
  await cleanup();
}
