import { afterEach, describe, expect, test, vi } from 'vitest';
import { configureClient, request } from './cp-client.js';

describe('CLI Control Plane client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configureClient({ baseUrl: 'http://localhost:3802', token: '' });
  });

  test('injects the bearer token into Control Plane requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run: { id: 'run_1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    configureClient({ baseUrl: 'https://cp.example.test', token: 'jwt-token' });

    await request('/api/runs/run_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cp.example.test/api/runs/run_1',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer jwt-token' }),
      }),
    );
  });

  test('surfaces structured Control Plane errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Token expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(request('/api/runs/run_1')).rejects.toThrow('Token expired');
  });

  test('normalizes network failures with the requested URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(request('/ready')).rejects.toThrow(
      'Network error connecting to http://localhost:3802/ready: connection refused',
    );
  });
});
