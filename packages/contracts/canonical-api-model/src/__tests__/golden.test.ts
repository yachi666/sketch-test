/**
 * Golden file tests for the Canonical API Model.
 *
 * These tests verify that the schema accepts valid fixtures and rejects
 * invalid ones. Golden files serve as compatibility guards — any change
 * to the schema must pass these tests or intentionally update the goldens.
 */
import { describe, expect, test } from 'vitest';
import { type CanonicalApiModel, CanonicalApiModelSchema } from '../index';

const VALID_FIXTURE: CanonicalApiModel = {
  schemaVersion: 'tap.canonical-api/v1',
  metadata: {
    sourceId: 'openapi-orders-v2',
    sourceType: 'openapi',
    sourceLabel: 'orders-openapi.yaml',
    sourceVersion: '2.3.1',
    sourceHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    parserName: '@tap/adapter-openapi',
    parserVersion: '0.1.0',
    ingestedAt: '2026-06-21T10:00:00.000Z',
  },
  servers: [
    {
      id: 'server-1',
      url: 'https://api.example.com/v2',
      description: 'Production server',
    },
  ],
  securitySchemes: [
    {
      id: 'bearer-auth',
      type: 'http',
      name: 'Bearer Auth',
      scheme: 'bearer',
    },
  ],
  schemas: {
    '/schemas/User': {
      id: '/schemas/User',
      type: 'object',
      properties: {
        id: { ref: '/schemas/User/properties/id', displayName: 'id' },
        name: { ref: '/schemas/User/properties/name', displayName: 'name' },
        email: { ref: '/schemas/User/properties/email', displayName: 'email' },
      },
      required: ['id', 'name', 'email'],
    },
    '/schemas/User/properties/id': {
      id: '/schemas/User/properties/id',
      type: 'integer',
      format: 'int64',
      description: 'Unique user identifier',
    },
    '/schemas/User/properties/name': {
      id: '/schemas/User/properties/name',
      type: 'string',
      minLength: 1,
      maxLength: 64,
    },
    '/schemas/User/properties/email': {
      id: '/schemas/User/properties/email',
      type: 'string',
      format: 'email',
    },
  },
  endpoints: [
    {
      id: 'POST-/api/users',
      operationId: 'createUser',
      method: 'POST',
      path: '/api/users',
      summary: 'Create a new user',
      deprecated: false,
      parameters: [],
      requestBodies: [
        {
          id: 'createUser-body',
          required: true,
          content: {
            'application/json': {
              schema: { ref: '/schemas/User' },
            },
          },
        },
      ],
      responses: [
        {
          id: 'createUser-201',
          statusCode: 201,
          description: 'User created successfully',
          content: {
            'application/json': {
              schema: { ref: '/schemas/User' },
            },
          },
        },
        {
          id: 'createUser-400',
          statusCode: 400,
          description: 'Validation error',
        },
      ],
      sourceLocations: [
        {
          sourceId: 'openapi-orders-v2',
          sourceLabel: 'orders-openapi.yaml',
          sourceVersion: '2.3.1',
          sourceHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
          ingestedAt: '2026-06-21T10:00:00.000Z',
          location: '$.paths./api/users.post',
        },
      ],
    },
  ],
  diagnostics: [],
};

describe('CanonicalApiModelSchema', () => {
  test('accepts a valid fixture', () => {
    const result = CanonicalApiModelSchema.safeParse(VALID_FIXTURE);
    expect(result.success).toBe(true);
  });

  test('rejects unknown schema version', () => {
    const invalid = { ...VALID_FIXTURE, schemaVersion: 'unknown/v99' };
    const result = CanonicalApiModelSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects endpoint without source locations', () => {
    const invalid = {
      ...VALID_FIXTURE,
      endpoints: [
        {
          ...VALID_FIXTURE.endpoints[0]!,
          sourceLocations: [],
        },
      ],
    };
    const result = CanonicalApiModelSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects invalid HTTP method', () => {
    const invalid = {
      ...VALID_FIXTURE,
      endpoints: [
        {
          ...VALID_FIXTURE.endpoints[0]!,
          method: 'INVALID',
        },
      ],
    };
    const result = CanonicalApiModelSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('rejects missing required endpoint id', () => {
    const { id, ...withoutId } = VALID_FIXTURE.endpoints[0]!;
    const invalid = {
      ...VALID_FIXTURE,
      endpoints: [{ ...withoutId }],
    };
    const result = CanonicalApiModelSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  test('validates schema tree references are dangling-safe', () => {
    // Schema model allows references that point to non-existent schemas
    // (validated at a higher level). The schema itself should still parse.
    const withDangling = {
      ...VALID_FIXTURE,
      schemas: {
        '/schemas/Thin': {
          id: '/schemas/Thin',
          type: 'object' as const,
          properties: {
            ghost: { ref: '/schemas/DoesNotExist' },
          },
        },
      },
    };
    const result = CanonicalApiModelSchema.safeParse(withDangling);
    expect(result.success).toBe(true);
  });
});
