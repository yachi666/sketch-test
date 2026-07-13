export interface RunnerConfig {
  nodeEnv: string;
  controlPlaneUrl: string;
  workspaceId: string;
  name: string;
  version: string;
  labels: string[];
  token?: string;
  id?: string;
  registrationToken?: string;
}

export function loadRunnerConfig(
  env: NodeJS.ProcessEnv = process.env,
  processId = process.pid,
): RunnerConfig {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const controlPlaneUrl = env['CP_URL'] ?? 'http://localhost:3802';
  try {
    new URL(controlPlaneUrl);
  } catch {
    throw new Error('CP_URL must be a valid absolute URL');
  }

  const token = env['RUNNER_TOKEN'];
  const id = env['RUNNER_ID'];
  const registrationToken = env['RUNNER_REGISTRATION_TOKEN'];
  if ((token && !id) || (!token && id)) {
    throw new Error('RUNNER_TOKEN and RUNNER_ID must be provided together');
  }
  if (nodeEnv === 'production' && (!token || !id) && !registrationToken) {
    throw new Error(
      'RUNNER_TOKEN/RUNNER_ID or RUNNER_REGISTRATION_TOKEN is required in production',
    );
  }

  return {
    nodeEnv,
    controlPlaneUrl: controlPlaneUrl.replace(/\/$/, ''),
    workspaceId: env['WORKSPACE_ID'] ?? 'ws_default',
    name: env['RUNNER_NAME'] ?? `runner-${processId}`,
    version: env['RUNNER_VERSION'] ?? '0.1.0',
    labels: (env['RUNNER_LABELS'] ?? '')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
    ...(token ? { token } : {}),
    ...(id ? { id } : {}),
    ...(registrationToken ? { registrationToken } : {}),
  };
}
