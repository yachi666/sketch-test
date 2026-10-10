import { describe, expect, test } from 'vitest';
import { loadRunnerConfig } from '../config.js';

describe('loadRunnerConfig', () => {
  test('provides development defaults', () => {
    expect(loadRunnerConfig({}, 42)).toMatchObject({
      nodeEnv: 'development',
      controlPlaneUrl: 'http://localhost:3802',
      workspaceId: 'ws_default',
      name: 'runner-42',
    });
  });

  test('normalizes the Control Plane URL and labels', () => {
    expect(
      loadRunnerConfig({ CP_URL: 'https://cp.example.com/', RUNNER_LABELS: 'linux, amd64 ' }),
    ).toMatchObject({
      controlPlaneUrl: 'https://cp.example.com',
      labels: ['linux', 'amd64'],
    });
  });

  test('rejects invalid URLs', () => {
    expect(() => loadRunnerConfig({ CP_URL: 'not-a-url' })).toThrow(/CP_URL/);
  });

  test('requires token and id as a pair', () => {
    expect(() => loadRunnerConfig({ RUNNER_TOKEN: 'token' })).toThrow(/together/);
    expect(() => loadRunnerConfig({ RUNNER_ID: 'runner' })).toThrow(/together/);
  });

  test('forbids anonymous registration in production', () => {
    expect(() => loadRunnerConfig({ NODE_ENV: 'production' })).toThrow(/required in production/);
  });

  test('accepts a production bootstrap registration token', () => {
    expect(
      loadRunnerConfig({ NODE_ENV: 'production', RUNNER_REGISTRATION_TOKEN: 'bootstrap' }),
    ).toMatchObject({ registrationToken: 'bootstrap' });
  });

  test('accepts provisioned production credentials', () => {
    expect(
      loadRunnerConfig({
        NODE_ENV: 'production',
        CP_URL: 'https://cp.example.com',
        RUNNER_TOKEN: 'token',
        RUNNER_ID: 'rnr-1',
      }),
    ).toMatchObject({ token: 'token', id: 'rnr-1' });
  });
});
