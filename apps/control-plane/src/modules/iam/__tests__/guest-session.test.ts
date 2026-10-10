import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { verifyJwt } from '../../../shared/jwt.js';

const { getUserMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

vi.mock('../iam.service.js', () => ({
  createServiceAccount: vi.fn(),
  createUser: vi.fn(),
  createWorkspace: vi.fn(),
  getUser: (...args: unknown[]) => getUserMock(...args),
  getUserByEmail: vi.fn(),
  getWorkspace: vi.fn(),
  listServiceAccounts: vi.fn(),
  listUsers: vi.fn(),
  revokeServiceAccount: vi.fn(),
  updateUserRole: vi.fn(),
  upgradePasswordHash: vi.fn(),
  verifyPassword: vi.fn(),
}));

import { iamRoutes } from '../iam.routes.js';

async function createApp() {
  const app = Fastify({ logger: false });
  await iamRoutes(app);
  await app.ready();
  return app;
}

describe('guest session', () => {
  beforeEach(() => {
    getUserMock.mockReset();
    vi.stubEnv('JWT_SECRET', 'guest-session-test-secret-at-least-32-characters');
    vi.stubEnv('GUEST_ACCESS_ENABLED', 'true');
    vi.stubEnv('GUEST_USER_ID', 'usr_guest');
    vi.stubEnv('GUEST_WORKSPACE_ID', 'ws_guest');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns a signed workspace-bound session for the configured identity', async () => {
    getUserMock.mockResolvedValue({
      id: 'usr_guest',
      workspaceId: 'ws_guest',
      email: 'guest@example.test',
      displayName: 'Guest',
      role: 'owner',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    const app = await createApp();

    const response = await app.inject({ method: 'POST', url: '/api/auth/guest' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body.enabled).toBe(true);
    expect(body.user).toMatchObject({ id: 'usr_guest', workspaceId: 'ws_guest', role: 'owner' });
    expect(verifyJwt(body.token)).toMatchObject({
      sub: 'usr_guest',
      workspaceId: 'ws_guest',
      role: 'owner',
    });
    await app.close();
  });

  test('is unavailable unless guest access is explicitly enabled', async () => {
    vi.stubEnv('GUEST_ACCESS_ENABLED', 'false');
    const app = await createApp();

    const response = await app.inject({ method: 'POST', url: '/api/auth/guest' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false });
    expect(getUserMock).not.toHaveBeenCalled();
    await app.close();
  });

  test('rejects a configured identity from another workspace', async () => {
    getUserMock.mockResolvedValue({
      id: 'usr_guest',
      workspaceId: 'ws_other',
      email: 'guest@example.test',
      displayName: 'Guest',
      role: 'owner',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    const app = await createApp();

    const response = await app.inject({ method: 'POST', url: '/api/auth/guest' });

    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
