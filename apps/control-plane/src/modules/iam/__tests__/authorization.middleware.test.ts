import Fastify from 'fastify';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { pool } from '../../../db/db.js';
import { signJwt } from '../../../shared/jwt.js';
import { authorizeControlPlaneRequest } from '../authorization.middleware.js';

vi.mock('../../../db/db.js', () => ({
  pool: { query: vi.fn() },
}));

const mockQuery = vi.mocked(pool.query);

function token(
  role: 'owner' | 'maintainer' | 'editor' | 'viewer',
  workspaceId = 'ws_primary',
): string {
  return signJwt({
    sub: `usr_${role}`,
    email: `${role}@example.test`,
    displayName: role,
    role,
    workspaceId,
  });
}

async function createApp() {
  const app = Fastify({ logger: false });
  app.addHook('preHandler', authorizeControlPlaneRequest);
  app.get('/health', async () => ({ ok: true }));
  app.get('/private', async (request) => ({ workspaceId: request.user?.workspaceId }));
  app.post('/private', async () => ({ ok: true }));
  app.post('/api/secrets', async () => ({ ok: true }));
  app.get('/api/runs/:id', async () => ({ ok: true }));
  app.post('/api/workspaces', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('authorizeControlPlaneRequest', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM users WHERE id')) {
        const userId = String(params?.[0] ?? 'usr_viewer');
        const role = userId.replace('usr_', '');
        return {
          rows: [
            {
              email: `${role}@example.test`,
              display_name: role,
              role,
            },
          ],
        } as never;
      }
      return { rows: [] } as never;
    });
  });

  test('keeps explicitly public routes public and defaults other routes to JWT auth', async () => {
    const app = await createApp();

    const publicResponse = await app.inject({ method: 'GET', url: '/health' });
    const privateResponse = await app.inject({ method: 'GET', url: '/private' });

    expect(publicResponse.statusCode).toBe(200);
    expect(privateResponse.statusCode).toBe(401);
    expect(privateResponse.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    await app.close();
  });

  test('enforces the viewer, editor, and maintainer role hierarchy', async () => {
    const app = await createApp();

    const viewerRead = await app.inject({
      method: 'GET',
      url: '/private',
      headers: { authorization: `Bearer ${token('viewer')}` },
    });
    const viewerWrite = await app.inject({
      method: 'POST',
      url: '/private',
      headers: { authorization: `Bearer ${token('viewer')}` },
    });
    const editorSecretWrite = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      headers: { authorization: `Bearer ${token('editor')}` },
    });
    const maintainerSecretWrite = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      headers: { authorization: `Bearer ${token('maintainer')}` },
    });

    expect(viewerRead.statusCode).toBe(200);
    expect(viewerWrite.statusCode).toBe(403);
    expect(editorSecretWrite.statusCode).toBe(403);
    expect(maintainerSecretWrite.statusCode).toBe(200);
    await app.close();
  });

  test('rejects a resource owned by another workspace without exposing its data', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ email: 'viewer@example.test', display_name: 'viewer', role: 'viewer' }],
      } as never)
      .mockResolvedValueOnce({ rows: [{ workspace_id: 'ws_other' }] } as never);
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run_other',
      headers: { authorization: `Bearer ${token('viewer')}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    await app.close();
  });

  test('returns not found for an unknown protected resource', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ email: 'viewer@example.test', display_name: 'viewer', role: 'viewer' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run_missing',
      headers: { authorization: `Bearer ${token('viewer')}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    await app.close();
  });

  test('allows only the first unauthenticated workspace bootstrap', async () => {
    const app = await createApp();
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] } as never);
    const first = await app.inject({ method: 'POST', url: '/api/workspaces' });
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] } as never);
    const later = await app.inject({ method: 'POST', url: '/api/workspaces' });

    expect(first.statusCode).toBe(200);
    expect(later.statusCode).toBe(401);
    await app.close();
  });

  test('uses the current database role instead of stale JWT role claims', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'owner@example.test', display_name: 'Owner', role: 'viewer' }],
    } as never);
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { authorization: `Bearer ${token('owner')}` },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
