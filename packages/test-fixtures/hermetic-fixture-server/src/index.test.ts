import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startFixtureServer } from './index.js';

describe('hermetic fixture server', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = await startFixtureServer(0, false);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  test('serves deterministic health and OpenAPI 3.1 documents', async () => {
    const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
    const specification = await fetch(`${baseUrl}/openapi.json`).then((response) =>
      response.json(),
    );

    expect(health).toEqual({ status: 'ok', time: '2026-06-21T10:00:00.000Z' });
    expect(specification).toMatchObject({ openapi: '3.1.0' });
  });

  test('reset restores the deterministic authentication sequence', async () => {
    const login = async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@sketch.dev', password: 'test123456' }),
      });
      return response.json() as Promise<{ data: { accessToken: string } }>;
    };

    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
    const first = await login();
    await fetch(`${baseUrl}/__admin/reset`, { method: 'POST' });
    const second = await login();

    expect(second.data.accessToken).toBe(first.data.accessToken);
  });
});
