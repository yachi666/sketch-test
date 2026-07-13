export interface ControlPlaneConfig {
  nodeEnv: string;
  host: string;
  port: number;
  logLevel: string;
  webOrigins: string[];
}

const REQUIRED_PRODUCTION_SECRETS = [
  'JWT_SECRET',
  'SECRET_KEY',
  'RUNNER_REGISTRATION_TOKEN',
] as const;
const REQUIRED_PRODUCTION_STORAGE = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET',
] as const;

function requireStrongSecret(
  env: NodeJS.ProcessEnv,
  name: (typeof REQUIRED_PRODUCTION_SECRETS)[number],
): void {
  const value = env[name];
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters in production`);
  }
}

export function loadControlPlaneConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const port = Number.parseInt(env['CP_PORT'] ?? '3802', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CP_PORT must be an integer between 1 and 65535');
  }

  if (nodeEnv === 'production') {
    if (!env['DATABASE_URL']) {
      throw new Error('DATABASE_URL must be set in production');
    }
    for (const name of REQUIRED_PRODUCTION_SECRETS) requireStrongSecret(env, name);
    for (const name of REQUIRED_PRODUCTION_STORAGE) {
      if (!env[name]) throw new Error(`${name} must be set in production`);
    }
    if (!env['WEB_ORIGINS']) throw new Error('WEB_ORIGINS must be set in production');
  }

  const webOrigins = (env['WEB_ORIGINS'] ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    host: env['CP_HOST'] ?? '0.0.0.0',
    port,
    logLevel: env['LOG_LEVEL'] ?? 'info',
    webOrigins,
  };
}
