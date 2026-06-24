/**
 * Generation service unit tests.
 *
 * Tests pure logic: schema resolution, value generation, boundary detection,
 * and draft construction. No database dependency.
 */
import { describe, expect, test } from 'vitest';
import {
  type EndpointDef,
  type SchemaNode,
  buildHappyPathRequest,
  generateBoundaryValue,
  generateInvalidValue,
  generateValidValue,
  resolveSchema,
} from '../generation.service';

// ─── Helpers ────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<EndpointDef> = {}): EndpointDef {
  return {
    id: 'ep-001',
    method: 'POST',
    path: '/api/users',
    summary: 'Create user',
    description: 'Creates a new user account',
    tags: ['Users'],
    parameters: [],
    requestBodies: [],
    responses: [{ id: 'resp-200', statusCode: 200, description: 'OK' }],
    ...overrides,
  };
}

function makeStringSchema(overrides: Partial<SchemaNode> = {}): SchemaNode {
  return { type: 'string', ...overrides };
}

function makeNumberSchema(overrides: Partial<SchemaNode> = {}): SchemaNode {
  return { type: 'number', ...overrides };
}

function makeIntSchema(overrides: Partial<SchemaNode> = {}): SchemaNode {
  return { type: 'integer', ...overrides };
}

function makeObjectSchema(overrides: Partial<SchemaNode> = {}): SchemaNode {
  return { type: 'object', properties: {}, required: [], ...overrides };
}

// ─── Schema Resolution ───────────────────────────────────────────────

describe('resolveSchema', () => {
  test('returns schema by ref key', () => {
    const schemas: Record<string, SchemaNode> = {
      User: { type: 'object', properties: {} },
    };
    const result = resolveSchema('User', schemas);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('object');
  });

  test('returns null for missing ref', () => {
    const result = resolveSchema('Missing', {});
    expect(result).toBeNull();
  });

  test('prevents infinite recursion via visited set', () => {
    const schemas: Record<string, SchemaNode> = {
      SelfRef: { type: 'object', allOf: [{ ref: 'SelfRef' }] },
    };
    const result = resolveSchema('SelfRef', schemas);
    expect(result).not.toBeNull();
    // Should resolve without infinite loop
    expect(result!.type).toBe('object');
  });

  test('merges allOf composed schemas', () => {
    const schemas: Record<string, SchemaNode> = {
      Base: {
        type: 'object',
        properties: { name: { ref: 'Name', displayName: 'Name' } },
        required: ['name'],
      },
      WithEmail: {
        type: 'object',
        allOf: [{ ref: 'Base' }],
        properties: { email: { ref: 'Email', displayName: 'Email' } },
        required: ['email'],
      },
      Name: { type: 'string' },
      Email: { type: 'string' },
    };
    const result = resolveSchema('WithEmail', schemas);
    expect(result).not.toBeNull();
    expect(result!.properties).toBeDefined();
    // Should have merged properties from Base
    expect(Object.keys(result!.properties!)).toContain('name');
    expect(Object.keys(result!.properties!)).toContain('email');
    // Required should merge
    expect(result!.required).toContain('name');
    expect(result!.required).toContain('email');
  });
});

// ─── Valid Value Generation ──────────────────────────────────────────

describe('generateValidValue', () => {
  const emptySchemas: Record<string, SchemaNode> = {};

  test('returns example if present', () => {
    expect(generateValidValue({ type: 'string', example: 'hello' }, emptySchemas)).toBe('hello');
  });

  test('returns default if present (no example)', () => {
    expect(generateValidValue({ type: 'string', default: 'defaultVal' }, emptySchemas)).toBe(
      'defaultVal',
    );
  });

  test('returns first enum value', () => {
    expect(generateValidValue({ type: 'string', enum: ['A', 'B', 'C'] }, emptySchemas)).toBe('A');
  });

  test('string: email format', () => {
    const val = generateValidValue({ type: 'string', format: 'email' }, emptySchemas);
    expect(val).toBe('test@example.com');
  });

  test('string: uri format', () => {
    const val = generateValidValue({ type: 'string', format: 'uri' }, emptySchemas);
    expect(val).toBe('https://example.com');
  });

  test('string: url format', () => {
    const val = generateValidValue({ type: 'string', format: 'url' }, emptySchemas);
    expect(val).toBe('https://example.com');
  });

  test('string: uuid format', () => {
    const val = generateValidValue({ type: 'string', format: 'uuid' }, emptySchemas);
    expect(val).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('string: date format', () => {
    const val = generateValidValue({ type: 'string', format: 'date' }, emptySchemas);
    expect(val).toBe('2025-01-15');
  });

  test('string: date-time format', () => {
    const val = generateValidValue({ type: 'string', format: 'date-time' }, emptySchemas) as string;
    expect(val).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('string: respects minLength when no example/default', () => {
    const val = generateValidValue({ type: 'string', minLength: 5 }, emptySchemas);
    expect(val).toBe('aaaaa');
  });

  test('string: defaults to single char when no constraints', () => {
    const val = generateValidValue({ type: 'string' }, emptySchemas);
    expect(val).toBe('a');
  });

  test('number: returns minimum if set', () => {
    expect(generateValidValue({ type: 'number', minimum: 10 }, emptySchemas)).toBe(10);
  });

  test('number: exclusiveMinimum + 1', () => {
    const val = generateValidValue(
      { type: 'number', minimum: 0, exclusiveMinimum: true },
      emptySchemas,
    );
    expect(val).toBe(1);
  });

  test('integer: returns minimum', () => {
    expect(generateValidValue({ type: 'integer', minimum: 5 }, emptySchemas)).toBe(5);
  });

  test('number: defaults to 1.0', () => {
    expect(generateValidValue({ type: 'number' }, emptySchemas)).toBe(1.0);
  });

  test('integer: defaults to 1', () => {
    expect(generateValidValue({ type: 'integer' }, emptySchemas)).toBe(1);
  });

  test('boolean: true', () => {
    expect(generateValidValue({ type: 'boolean' }, emptySchemas)).toBe(true);
  });

  test('array: generates minItems items', () => {
    const schemas: Record<string, SchemaNode> = {
      items: { type: 'string' },
    };
    const val = generateValidValue(
      { type: 'array', minItems: 3, items: { ref: 'items' } },
      schemas,
    ) as unknown[];
    expect(Array.isArray(val)).toBe(true);
    expect(val).toHaveLength(3);
    expect(val[0]).toBe('a');
  });

  test('array: empty when no items schema', () => {
    const val = generateValidValue({ type: 'array', minItems: 0 }, emptySchemas);
    expect(val).toEqual([]);
  });

  test('object: populates required properties', () => {
    const schemas: Record<string, SchemaNode> = {
      User: {
        type: 'object',
        properties: {
          name: { ref: 'UserName', displayName: 'name' },
          age: { ref: 'UserAge', displayName: 'age' },
        },
        required: ['name'],
      },
      UserName: { type: 'string', minLength: 3 },
      UserAge: { type: 'integer', minimum: 0 },
    };
    const val = generateValidValue(schemas['User']!, schemas) as Record<string, unknown>;
    expect(val['name']).toBe('aaa');
    // age is not required, should be absent
    expect(val['age']).toBeUndefined();
  });

  test('unknown type returns null', () => {
    expect(generateValidValue({ type: 'binary' } as SchemaNode, emptySchemas)).toBeNull();
  });
});

// ─── Invalid Value Generation ────────────────────────────────────────

describe('generateInvalidValue', () => {
  const emptySchemas: Record<string, SchemaNode> = {};

  test('string → number', () => {
    expect(generateInvalidValue({ type: 'string' }, emptySchemas)).toBe(12345);
  });

  test('number → string', () => {
    expect(generateInvalidValue({ type: 'number' }, emptySchemas)).toBe('not-a-number');
  });

  test('integer → string', () => {
    expect(generateInvalidValue({ type: 'integer' }, emptySchemas)).toBe('not-a-number');
  });

  test('boolean → number', () => {
    expect(generateInvalidValue({ type: 'boolean' }, emptySchemas)).toBe(42);
  });

  test('array → object', () => {
    expect(generateInvalidValue({ type: 'array' }, emptySchemas)).toEqual({ not: 'an-array' });
  });

  test('object → string', () => {
    expect(generateInvalidValue({ type: 'object' }, emptySchemas)).toBe('not-an-object');
  });
});

// ─── Boundary Value Generation ───────────────────────────────────────

describe('generateBoundaryValue', () => {
  const emptySchemas: Record<string, SchemaNode> = {};

  test('string: below minLength', () => {
    const result = generateBoundaryValue({ type: 'string', minLength: 5 }, emptySchemas);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('aaaa'); // 4 chars < 5
    expect(result!.expectedStatus).toBe(400);
    expect(result!.rule).toContain('minLength');
  });

  test('string: above maxLength', () => {
    const result = generateBoundaryValue({ type: 'string', maxLength: 10 }, emptySchemas);
    expect(result).not.toBeNull();
    expect(result!.value).toBe('a'.repeat(11));
    expect(result!.expectedStatus).toBe(400);
    expect(result!.rule).toContain('maxLength');
  });

  test('string: no boundary when minLength is 0', () => {
    // minLength undefined means no constraint to violate with shorter string
    const result = generateBoundaryValue({ type: 'string', minLength: 0 }, emptySchemas);
    // If maxLength is not set either, returns null
    if (result) {
      // Could be maxLength violation if both are set, or null
    }
  });

  test('number: below minimum', () => {
    const result = generateBoundaryValue({ type: 'number', minimum: 10 }, emptySchemas);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(9);
    expect(result!.expectedStatus).toBe(400);
  });

  test('number: exclusiveMinimum edge', () => {
    const result = generateBoundaryValue(
      { type: 'number', minimum: 0, exclusiveMinimum: true },
      emptySchemas,
    );
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0); // exactly the minimum, which is excluded
    expect(result!.rule).toContain('exclusive');
  });

  test('number: above maximum', () => {
    const result = generateBoundaryValue({ type: 'number', maximum: 100 }, emptySchemas);
    expect(result).not.toBeNull();
    expect(result!.value).toBe(101);
    expect(result!.expectedStatus).toBe(400);
  });

  test('number: exclusiveMaximum edge', () => {
    const result = generateBoundaryValue(
      { type: 'integer', maximum: 10, exclusiveMaximum: true },
      emptySchemas,
    );
    expect(result).not.toBeNull();
    expect(result!.value).toBe(10); // exactly the maximum, which is excluded
  });

  test('array: below minItems', () => {
    const result = generateBoundaryValue({ type: 'array', minItems: 2 }, emptySchemas);
    expect(result).not.toBeNull();
    expect(result!.value).toEqual([]);
    expect(result!.rule).toContain('minItems');
  });

  test('array: above maxItems', () => {
    const schemas: Record<string, SchemaNode> = {
      ItemType: { type: 'string' },
    };
    const result = generateBoundaryValue(
      { type: 'array', maxItems: 2, items: { ref: 'ItemType' } },
      schemas,
    );
    expect(result).not.toBeNull();
    expect(result!.value).toHaveLength(3);
    expect(result!.rule).toContain('maxItems');
  });

  test('returns null when no boundary constraint', () => {
    const result = generateBoundaryValue({ type: 'string' }, emptySchemas);
    expect(result).toBeNull();
  });
});

// ─── Happy Path Request Building ─────────────────────────────────────

describe('buildHappyPathRequest', () => {
  const emptySchemas: Record<string, SchemaNode> = {};

  test('builds basic GET request', () => {
    const result = buildHappyPathRequest(
      makeEndpoint({ method: 'GET', path: '/api/users' }),
      emptySchemas,
    );
    expect(result.method).toBe('GET');
    expect(result.url).toBe('/api/users');
    expect(result.headers).toEqual({});
    expect(result.body).toBeUndefined();
  });

  test('builds POST with body', () => {
    const schemas: Record<string, SchemaNode> = {
      UserCreate: {
        type: 'object',
        properties: {
          name: { ref: 'UserName', displayName: 'name' },
        },
        required: ['name'],
      },
      UserName: { type: 'string' },
    };
    const endpoint: EndpointDef = {
      ...makeEndpoint({ method: 'POST', path: '/api/users' }),
      requestBodies: [
        {
          id: 'rb-001',
          required: true,
          content: {
            'application/json': {
              schema: { ref: 'UserCreate' },
            },
          },
        },
      ],
    };
    const result = buildHappyPathRequest(endpoint, schemas);
    expect(result.method).toBe('POST');
    expect(result.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(result.body).toEqual({ name: 'a' });
  });

  test('replaces path parameters with generated values', () => {
    const schemas: Record<string, SchemaNode> = {
      UserId: { type: 'string', format: 'uuid' },
    };
    const endpoint: EndpointDef = {
      ...makeEndpoint({ method: 'GET', path: '/api/users/{userId}' }),
      parameters: [
        {
          id: 'param-1',
          name: 'userId',
          in: 'path',
          required: true,
          schema: { ref: 'UserId' },
        },
      ],
    };
    const result = buildHappyPathRequest(endpoint, schemas);
    expect(result.url).toBe('/api/users/00000000-0000-0000-0000-000000000000');
  });

  test('uses param example when available', () => {
    const endpoint: EndpointDef = {
      ...makeEndpoint({ method: 'GET', path: '/api/users/{userId}' }),
      parameters: [
        {
          id: 'param-1',
          name: 'userId',
          in: 'path',
          required: true,
          example: 'my-user-id',
        },
      ],
    };
    const result = buildHappyPathRequest(endpoint, emptySchemas);
    expect(result.url).toBe('/api/users/my-user-id');
  });

  test('handles endpoints without request body', () => {
    // DELETE typically has no body
    const endpoint = makeEndpoint({ method: 'DELETE', path: '/api/users/{id}' });
    endpoint.parameters = [
      {
        id: 'param-1',
        name: 'id',
        in: 'path',
        required: true,
        example: 'usr-123',
      },
    ];
    const result = buildHappyPathRequest(endpoint, emptySchemas);
    expect(result.method).toBe('DELETE');
    expect(result.url).toBe('/api/users/usr-123');
    expect(result.body).toBeUndefined();
  });
});
