import { describe, expect, test } from 'vitest';
import { loadControlPlaneConfig } from '../config.js';

const strong = 'a'.repeat(32);
const storage = {
  S3_ENDPOINT: 'https://s3.example.com',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET: 'evidence',
};

describe('loadControlPlaneConfig', () => {
  test('provides explicit development defaults', () => {
    expect(loadControlPlaneConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3802,
      logLevel: 'info',
      webOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      importAllowedHosts: ['127.0.0.1', 'localhost', '[::1]'],
    });
  });

  test('rejects invalid ports', () => {
    expect(() => loadControlPlaneConfig({ CP_PORT: '0' })).toThrow(/CP_PORT/);
    expect(() => loadControlPlaneConfig({ CP_PORT: 'not-a-port' })).toThrow(/CP_PORT/);
  });

  test('fails fast when production database configuration is absent', () => {
    expect(() => loadControlPlaneConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  test.each(['JWT_SECRET', 'SECRET_KEY', 'RUNNER_REGISTRATION_TOKEN'] as const)(
    'requires a strong production %s',
    (missing) => {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/sketchtest',
        JWT_SECRET: strong,
        SECRET_KEY: strong,
        RUNNER_REGISTRATION_TOKEN: strong,
        ...storage,
        WEB_ORIGINS: 'https://app.example.com',
        IMPORT_ALLOWED_HOSTS: 'specs.example.com',
      };
      delete env[missing];
      expect(() => loadControlPlaneConfig(env)).toThrow(new RegExp(missing));
    },
  );

  test('accepts a complete production configuration', () => {
    expect(
      loadControlPlaneConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/sketchtest',
        JWT_SECRET: strong,
        SECRET_KEY: strong,
        RUNNER_REGISTRATION_TOKEN: strong,
        ...storage,
        WEB_ORIGINS: 'https://app.example.com',
        IMPORT_ALLOWED_HOSTS: 'specs.example.com, specs-backup.example.com:8443',
        CP_PORT: '8080',
      }),
    ).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      importAllowedHosts: ['specs.example.com', 'specs-backup.example.com:8443'],
    });
  });

  test.each(Object.keys(storage))('requires production storage setting %s', (missing) => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db/sketchtest',
      JWT_SECRET: strong,
      SECRET_KEY: strong,
      RUNNER_REGISTRATION_TOKEN: strong,
      ...storage,
      WEB_ORIGINS: 'https://app.example.com',
      IMPORT_ALLOWED_HOSTS: 'specs.example.com',
    };
    delete env[missing];
    expect(() => loadControlPlaneConfig(env)).toThrow(new RegExp(missing));
  });

  test('requires explicit browser origins in production', () => {
    expect(() =>
      loadControlPlaneConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/sketchtest',
        JWT_SECRET: strong,
        SECRET_KEY: strong,
        RUNNER_REGISTRATION_TOKEN: strong,
        ...storage,
        IMPORT_ALLOWED_HOSTS: 'specs.example.com',
      }),
    ).toThrow(/WEB_ORIGINS/);
  });

  test('requires explicit import hosts in production', () => {
    expect(() =>
      loadControlPlaneConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db/sketchtest',
        JWT_SECRET: strong,
        SECRET_KEY: strong,
        RUNNER_REGISTRATION_TOKEN: strong,
        ...storage,
        WEB_ORIGINS: 'https://app.example.com',
      }),
    ).toThrow(/IMPORT_ALLOWED_HOSTS/);
  });
});
