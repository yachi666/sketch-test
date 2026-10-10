/**
 * Health routes unit tests.
 *
 * Tests health check endpoint logic — DB status mapping and response shape.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ─── Mock DB health check ──────────────────────────────────────────

const { mockHealthCheck, mockObjectStorageHealthCheck } = vi.hoisted(() => ({
  mockHealthCheck: vi.fn(),
  mockObjectStorageHealthCheck: vi.fn(),
}));

vi.mock('../../../db/db.js', () => ({
  pool: {},
  healthCheck: (...args: unknown[]) => mockHealthCheck(...args),
}));

vi.mock('../../../shared/object-storage.js', () => ({
  objectStorageHealthCheck: (...args: unknown[]) => mockObjectStorageHealthCheck(...args),
}));

// ─── Mock Fastify app ──────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { healthRoutes } from '../health.routes';

// Build a lightweight test app with the health route registered
async function buildTestApp(): Promise<FastifyInstance> {
  // Use dynamic import to avoid circular dependency issues
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('healthRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockHealthCheck.mockReset();
    mockObjectStorageHealthCheck.mockReset().mockResolvedValue(true);
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /health returns 200 and ok status when DB is connected', async () => {
    mockHealthCheck.mockResolvedValue(true);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(body).toHaveProperty('timestamp');
    // Validate timestamp is a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
  });

  test('GET /health returns 503 and degraded status when DB is disconnected', async () => {
    mockHealthCheck.mockResolvedValue(false);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('disconnected');
  });

  test('GET /health returns 500 when DB query throws (unhandled promise rejection)', async () => {
    // Fastify returns 500 for unhandled async errors in route handlers.
    // The health route does NOT catch rejected promises from healthCheck().
    mockHealthCheck.mockRejectedValue(new Error('Connection refused'));

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    // Fastify default error handler returns 500 for unhandled rejections
    expect(response.statusCode).toBe(500);
  });

  test('GET /health timestamp is current ISO string', async () => {
    mockHealthCheck.mockResolvedValue(true);
    const before = new Date();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = response.json();
    const timestamp = new Date(body.timestamp);
    const after = new Date();

    // Timestamp should be within a reasonable window (with some tolerance)
    expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  test('GET /health/live reports process liveness without dependency checks', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
    expect(mockHealthCheck).not.toHaveBeenCalled();
  });

  test('GET /ready requires both PostgreSQL and object storage', async () => {
    mockHealthCheck.mockResolvedValue(true);
    mockObjectStorageHealthCheck.mockResolvedValue(false);
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'not_ready',
      db: 'connected',
      objectStore: 'disconnected',
    });
  });

  test('GET /ready reports ready only when every dependency responds', async () => {
    mockHealthCheck.mockResolvedValue(true);
    mockObjectStorageHealthCheck.mockResolvedValue(true);
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');
  });
});
