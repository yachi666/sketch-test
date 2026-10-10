import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../db/db.js', () => ({ healthCheck: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../shared/object-storage.js', () => ({
  objectStorageHealthCheck: vi.fn().mockResolvedValue(false),
}));

import { metrics } from '../../../shared/metrics.js';
import { observabilityRoutes } from '../observability.routes.js';

describe('observabilityRoutes', () => {
  beforeEach(() => metrics.reset());
  afterEach(() => metrics.reset());

  test('renders Prometheus counters without exposing raw dynamic paths', async () => {
    metrics.recordHttp('GET', '/api/runs/:id', 200, 25);
    metrics.recordHttp('GET', '/api/runs/:id', 200, 75);
    const app = Fastify();
    await app.register(observabilityRoutes);
    const response = await app.inject({ method: 'GET', url: '/metrics' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('sketchtest_dependency_up{dependency="postgres"} 1');
    expect(response.body).toContain('sketchtest_dependency_up{dependency="object-store"} 0');
    expect(response.body).toContain(
      'sketchtest_http_request_duration_seconds_bucket{method="GET",route="/api/runs/:id",status="200",le="0.025"} 1',
    );
    expect(response.body).toContain(
      'sketchtest_http_request_duration_seconds_bucket{method="GET",route="/api/runs/:id",status="200",le="+Inf"} 2',
    );
    expect(response.body).toContain(
      'sketchtest_http_request_duration_seconds_count{method="GET",route="/api/runs/:id",status="200"} 2',
    );
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain(
      'sketchtest_http_requests_total{method="GET",route="/api/runs/:id",status="200"} 2',
    );
    expect(response.body).toContain(
      'sketchtest_http_request_duration_seconds_sum{method="GET",route="/api/runs/:id",status="200"} 0.1',
    );
  });
});
