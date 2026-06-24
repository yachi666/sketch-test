/**
 * Diff service unit tests.
 *
 * Tests pure logic: API version diffing and breaking change detection.
 * No database dependency.
 */
import { describe, expect, test } from 'vitest';
import type { CanonicalApiModel, Endpoint } from '@sketch-test/canonical-api-model';
import { computeDiff, isSchemaBreakingChange, type DiffEntry } from '../diff.service';

// ─── Helpers ────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 'get /users',
    method: 'GET',
    path: '/users',
    parameters: [],
    requestBodies: [],
    responses: [],
    sourceLocations: [{ file: 'spec.yaml', line: 10 }],
    ...overrides,
  } as Endpoint;
}

function makeModel(
  endpoints: Endpoint[] = [],
  servers: { id: string; url: string }[] = [],
): CanonicalApiModel {
  return {
    endpoints,
    servers: servers.map((s) => ({ ...s, variables: {} })),
    schemas: {},
  } as unknown as CanonicalApiModel;
}

function findChange(changes: DiffEntry[], category: string, type: string): DiffEntry | undefined {
  return changes.find((c) => c.category === category && c.type === type);
}

// ─── Endpoint Diffing ────────────────────────────────────────────────

describe('computeDiff: endpoints', () => {
  test('detects added endpoints', () => {
    const base = makeModel([makeEndpoint({ id: 'get /users', method: 'GET', path: '/users' })]);
    const target = makeModel([
      makeEndpoint({ id: 'get /users', method: 'GET', path: '/users' }),
      makeEndpoint({ id: 'post /users', method: 'POST', path: '/users' }),
    ]);

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'endpoint', 'added');
    expect(added).toBeDefined();
    expect(added!.path).toBe('POST /users');
    expect(added!.breaking).toBe(false);
  });

  test('detects removed endpoints (breaking)', () => {
    const base = makeModel([
      makeEndpoint({ id: 'get /users' }),
      makeEndpoint({ id: 'delete /users/{id}', method: 'DELETE', path: '/users/{id}' }),
    ]);
    const target = makeModel([makeEndpoint({ id: 'get /users' })]);

    const changes = computeDiff(base, target);
    const removed = findChange(changes, 'endpoint', 'removed');
    expect(removed).toBeDefined();
    expect(removed!.path).toBe('DELETE /users/{id}');
    expect(removed!.breaking).toBe(true);
  });

  test('no changes for identical models', () => {
    const ep = makeEndpoint();
    const model = makeModel([ep]);
    expect(computeDiff(model, model)).toHaveLength(0);
  });
});

// ─── Parameter Diffing ───────────────────────────────────────────────

describe('computeDiff: parameters', () => {
  test('detects added required parameter (breaking)', () => {
    const base = makeModel([makeEndpoint()]);
    const target = makeModel([
      makeEndpoint({
        parameters: [
          { id: 'p1', name: 'apiKey', in: 'query', required: true } as Endpoint['parameters'][0],
        ],
      }),
    ]);

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'parameter', 'added');
    expect(added).toBeDefined();
    expect(added!.breaking).toBe(true);
  });

  test('detects added optional parameter (not breaking)', () => {
    const base = makeModel([makeEndpoint()]);
    const target = makeModel([
      makeEndpoint({
        parameters: [
          { id: 'p1', name: 'page', in: 'query', required: false } as Endpoint['parameters'][0],
        ],
      }),
    ]);

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'parameter', 'added');
    expect(added).toBeDefined();
    expect(added!.breaking).toBe(false);
  });

  test('detects removed parameter (breaking)', () => {
    const base = makeModel([
      makeEndpoint({
        parameters: [
          { id: 'p1', name: 'userId', in: 'path', required: true } as Endpoint['parameters'][0],
        ],
      }),
    ]);
    const target = makeModel([makeEndpoint()]);

    const changes = computeDiff(base, target);
    const removed = findChange(changes, 'parameter', 'removed');
    expect(removed).toBeDefined();
    expect(removed!.breaking).toBe(true);
  });

  test('detects parameter required change: false → true (breaking)', () => {
    const base = makeModel([
      makeEndpoint({
        parameters: [
          { id: 'p1', name: 'filter', in: 'query', required: false } as Endpoint['parameters'][0],
        ],
      }),
    ]);
    const target = makeModel([
      makeEndpoint({
        parameters: [
          { id: 'p1', name: 'filter', in: 'query', required: true } as Endpoint['parameters'][0],
        ],
      }),
    ]);

    const changes = computeDiff(base, target);
    const modified = findChange(changes, 'parameter', 'modified');
    expect(modified).toBeDefined();
    expect(modified!.breaking).toBe(true);
  });

  test('detects parameter schema change', () => {
    const base = makeModel([
      makeEndpoint({
        parameters: [
          {
            id: 'p1',
            name: 'id',
            in: 'path',
            schema: { ref: 'string' },
          } as Endpoint['parameters'][0],
        ],
      }),
    ]);
    const target = makeModel([
      makeEndpoint({
        parameters: [
          {
            id: 'p1',
            name: 'id',
            in: 'path',
            schema: { ref: 'integer' },
          } as Endpoint['parameters'][0],
        ],
      }),
    ]);

    const changes = computeDiff(base, target);
    const modified = findChange(changes, 'parameter', 'modified');
    expect(modified).toBeDefined();
  });
});

// ─── Request Body Diffing ────────────────────────────────────────────

describe('computeDiff: request bodies', () => {
  test('detects added request body', () => {
    const base = makeModel([makeEndpoint()]);
    const target = makeModel([
      makeEndpoint({ requestBodies: [{ id: 'rb1' } as Endpoint['requestBodies'][0]] }),
    ]);

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'requestBody', 'added');
    expect(added).toBeDefined();
    expect(added!.breaking).toBe(false);
  });

  test('detects removed request body (breaking)', () => {
    const base = makeModel([
      makeEndpoint({ requestBodies: [{ id: 'rb1' } as Endpoint['requestBodies'][0]] }),
    ]);
    const target = makeModel([makeEndpoint()]);

    const changes = computeDiff(base, target);
    const removed = findChange(changes, 'requestBody', 'removed');
    expect(removed).toBeDefined();
    expect(removed!.breaking).toBe(true);
  });
});

// ─── Response Diffing ────────────────────────────────────────────────

describe('computeDiff: responses', () => {
  test('detects added response', () => {
    const base = makeModel([
      makeEndpoint({
        responses: [{ id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0]],
      }),
    ]);
    const target = makeModel([
      makeEndpoint({
        responses: [
          { id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0],
          { id: 'r404', statusCode: 404, description: 'Not Found' } as Endpoint['responses'][0],
        ],
      }),
    ]);

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'response', 'added');
    expect(added).toBeDefined();
    expect(added!.path).toContain('404');
  });

  test('detects removed response (breaking)', () => {
    const base = makeModel([
      makeEndpoint({
        responses: [
          { id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0],
          { id: 'r201', statusCode: 201, description: 'Created' } as Endpoint['responses'][0],
        ],
      }),
    ]);
    const target = makeModel([
      makeEndpoint({
        responses: [{ id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0]],
      }),
    ]);

    const changes = computeDiff(base, target);
    const removed = findChange(changes, 'response', 'removed');
    expect(removed).toBeDefined();
    expect(removed!.breaking).toBe(true);
  });
});

// ─── Server Diffing ──────────────────────────────────────────────────

describe('computeDiff: servers', () => {
  test('detects added server', () => {
    const base = makeModel([], [{ id: 's1', url: 'https://api.example.com' }]);
    const target = makeModel(
      [],
      [
        { id: 's1', url: 'https://api.example.com' },
        { id: 's2', url: 'https://api-staging.example.com' },
      ],
    );

    const changes = computeDiff(base, target);
    const added = findChange(changes, 'server', 'added');
    expect(added).toBeDefined();
    expect(added!.path).toContain('api-staging');
  });

  test('detects removed server (breaking)', () => {
    const base = makeModel(
      [],
      [
        { id: 's1', url: 'https://api.example.com' },
        { id: 's2', url: 'https://old.example.com' },
      ],
    );
    const target = makeModel([], [{ id: 's1', url: 'https://api.example.com' }]);

    const changes = computeDiff(base, target);
    const removed = findChange(changes, 'server', 'removed');
    expect(removed).toBeDefined();
    expect(removed!.breaking).toBe(true);
  });
});

// ─── Summary Counts ──────────────────────────────────────────────────

describe('computeDiff: summary counts', () => {
  test('correctly counts change types', () => {
    // Base has 2 endpoints, target removes 1 and modifies another's parameter
    const base = makeModel([
      makeEndpoint({
        id: 'get /users',
        responses: [{ id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0]],
      }),
      makeEndpoint({
        id: 'get /orders',
        method: 'GET',
        path: '/orders',
        parameters: [
          { id: 'p1', name: 'status', in: 'query', required: true } as Endpoint['parameters'][0],
        ],
        responses: [{ id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0]],
      }),
    ]);
    const target = makeModel([
      makeEndpoint({
        id: 'get /orders',
        method: 'GET',
        path: '/orders',
        parameters: [
          { id: 'p1', name: 'status', in: 'query', required: false } as Endpoint['parameters'][0],
        ],
        responses: [{ id: 'r200', statusCode: 200, description: 'OK' } as Endpoint['responses'][0]],
      }),
    ]);

    const changes = computeDiff(base, target);
    expect(changes.filter((c) => c.type === 'added').length).toBeGreaterThanOrEqual(0);
    expect(changes.filter((c) => c.type === 'removed').length).toBeGreaterThanOrEqual(1); // endpoint removed
    expect(changes.filter((c) => c.type === 'modified').length).toBeGreaterThanOrEqual(1); // param required changed
  });
});

// ─── Breaking Change Detection ───────────────────────────────────────

describe('isSchemaBreakingChange', () => {
  test('new required field → breaking', () => {
    const before = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } };
    const after = {
      type: 'object',
      required: ['name', 'email'],
      properties: { name: { type: 'string' }, email: { type: 'string' } },
    };
    expect(isSchemaBreakingChange(before, after)).toBe(true);
  });

  test('removing required field → not breaking from schema perspective', () => {
    const before = { type: 'object', required: ['name', 'email'] };
    const after = { type: 'object', required: ['name'] };
    expect(isSchemaBreakingChange(before, after)).toBe(false);
  });

  test('removing property → breaking', () => {
    const before = {
      type: 'object',
      properties: { name: { type: 'string' }, email: { type: 'string' } },
    };
    const after = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    expect(isSchemaBreakingChange(before, after)).toBe(true);
  });

  test('narrowing enum → breaking', () => {
    const before = { type: 'string', enum: ['A', 'B', 'C'] };
    const after = { type: 'string', enum: ['A'] };
    expect(isSchemaBreakingChange(before, after)).toBe(true);
  });

  test('expanding enum → not breaking', () => {
    const before = { type: 'string', enum: ['A'] };
    const after = { type: 'string', enum: ['A', 'B', 'C'] };
    expect(isSchemaBreakingChange(before, after)).toBe(false);
  });

  test('type change → breaking', () => {
    const before = { type: 'string' };
    const after = { type: 'integer' };
    expect(isSchemaBreakingChange(before, after)).toBe(true);
  });

  test('same schema → not breaking', () => {
    const schema = { type: 'string', minLength: 1, maxLength: 100 };
    expect(isSchemaBreakingChange(schema, { ...schema })).toBe(false);
  });

  test('non-object values → breaking (structural change)', () => {
    expect(isSchemaBreakingChange('string', 123)).toBe(true);
    expect(isSchemaBreakingChange(null, {})).toBe(true);
  });

  test('empty enums in after → not breaking', () => {
    const before = { type: 'string', enum: ['A', 'B'] };
    const after = { type: 'string', enum: [] };
    // After has empty enum (length 0), so aEnum.length > 0 is false → not breaking
    expect(isSchemaBreakingChange(before, after)).toBe(false);
  });
});
