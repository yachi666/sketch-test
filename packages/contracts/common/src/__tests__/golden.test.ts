/**
 * Golden tests for @sketch-test/contracts-common.
 *
 * Validates that the shared Zod schemas accept valid data and reject invalid data.
 * These are the foundation primitives — if they break, everything breaks.
 */
import { describe, expect, test } from 'vitest';
import {
  ApiErrorResponseSchema,
  ContentHashSchema,
  EntityIdSchema,
  EnvironmentSchema,
  HttpMethodSchema,
  HttpStatusCodeSchema,
  InstantSchema,
  SemanticVersionSchema,
  VariableDefinitionSchema,
  VariableScopeSchema,
} from '../index';

// ─── EntityId ──────────────────────────────────────────────────────

describe('EntityIdSchema', () => {
  test('accepts valid identifiers', () => {
    expect(EntityIdSchema.safeParse('user-001').success).toBe(true);
    expect(EntityIdSchema.safeParse('test_case.v2').success).toBe(true);
    expect(EntityIdSchema.safeParse('a/b:c').success).toBe(true);
    expect(EntityIdSchema.safeParse('env_{prod}').success).toBe(true);
  });

  test('rejects empty string', () => {
    expect(EntityIdSchema.safeParse('').success).toBe(false);
  });

  test('rejects strings over 256 chars', () => {
    expect(EntityIdSchema.safeParse('a'.repeat(257)).success).toBe(false);
  });

  test('rejects invalid characters', () => {
    expect(EntityIdSchema.safeParse('hello world').success).toBe(false);
    expect(EntityIdSchema.safeParse('user@domain').success).toBe(false);
  });
});

// ─── ContentHash ───────────────────────────────────────────────────

describe('ContentHashSchema', () => {
  test('accepts valid SHA-256 hex', () => {
    expect(ContentHashSchema.safeParse('a'.repeat(64)).success).toBe(true);
    expect(
      ContentHashSchema.safeParse(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      ).success,
    ).toBe(true);
  });

  test('rejects wrong length', () => {
    expect(ContentHashSchema.safeParse('abc').success).toBe(false);
    expect(ContentHashSchema.safeParse('a'.repeat(63)).success).toBe(false);
  });

  test('rejects non-hex characters', () => {
    expect(ContentHashSchema.safeParse('g'.repeat(64)).success).toBe(false);
  });
});

// ─── SemanticVersion ───────────────────────────────────────────────

describe('SemanticVersionSchema', () => {
  test('accepts valid semver', () => {
    expect(SemanticVersionSchema.safeParse('1.0.0').success).toBe(true);
    expect(SemanticVersionSchema.safeParse('2.3.4-alpha.1').success).toBe(true);
    expect(SemanticVersionSchema.safeParse('0.1.0+build.123').success).toBe(true);
  });

  test('rejects invalid semver', () => {
    expect(SemanticVersionSchema.safeParse('1.0').success).toBe(false);
    expect(SemanticVersionSchema.safeParse('v1.0.0').success).toBe(false);
    expect(SemanticVersionSchema.safeParse('not-a-version').success).toBe(false);
  });
});

// ─── Instant ───────────────────────────────────────────────────────

describe('InstantSchema', () => {
  test('accepts ISO-8601 with timezone', () => {
    expect(InstantSchema.safeParse('2026-06-21T10:00:00.000Z').success).toBe(true);
    expect(InstantSchema.safeParse('2026-06-21T10:00:00+08:00').success).toBe(true);
  });

  test('rejects missing timezone', () => {
    expect(InstantSchema.safeParse('2026-06-21T10:00:00').success).toBe(false);
  });

  test('rejects non-datetime strings', () => {
    expect(InstantSchema.safeParse('yesterday').success).toBe(false);
  });
});

// ─── HttpMethod ────────────────────────────────────────────────────

describe('HttpMethodSchema', () => {
  test('accepts all standard methods', () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(HttpMethodSchema.safeParse(m).success).toBe(true);
    }
  });

  test('rejects non-standard methods', () => {
    expect(HttpMethodSchema.safeParse('TRACE').success).toBe(false);
    expect(HttpMethodSchema.safeParse('CONNECT').success).toBe(false);
  });
});

// ─── HttpStatusCode ────────────────────────────────────────────────

describe('HttpStatusCodeSchema', () => {
  test('accepts known status codes', () => {
    expect(HttpStatusCodeSchema.safeParse(200).success).toBe(true);
    expect(HttpStatusCodeSchema.safeParse(404).success).toBe(true);
    expect(HttpStatusCodeSchema.safeParse(500).success).toBe(true);
  });

  test('accepts any status code 100-599', () => {
    expect(HttpStatusCodeSchema.safeParse(304).success).toBe(true);
    expect(HttpStatusCodeSchema.safeParse(418).success).toBe(true);
  });

  test('rejects out-of-range codes', () => {
    expect(HttpStatusCodeSchema.safeParse(99).success).toBe(false);
    expect(HttpStatusCodeSchema.safeParse(600).success).toBe(false);
  });
});

// ─── VariableScope ─────────────────────────────────────────────────

describe('VariableScopeSchema', () => {
  test('accepts all scopes', () => {
    for (const s of ['step', 'workflow', 'environment', 'secret']) {
      expect(VariableScopeSchema.safeParse(s).success).toBe(true);
    }
  });

  test('rejects unknown scope', () => {
    expect(VariableScopeSchema.safeParse('global').success).toBe(false);
  });
});

// ─── VariableDefinition ────────────────────────────────────────────

describe('VariableDefinitionSchema', () => {
  const validVariable = {
    id: 'var-001',
    name: 'baseUrl',
    type: 'plain' as const,
    scope: 'environment' as const,
    defaultValue: 'http://localhost:3800',
    description: 'Base URL for the API under test',
  };

  test('accepts valid variable', () => {
    expect(VariableDefinitionSchema.safeParse(validVariable).success).toBe(true);
  });

  test('accepts secret variable', () => {
    expect(
      VariableDefinitionSchema.safeParse({
        ...validVariable,
        type: 'secret',
        sensitive: true,
      }).success,
    ).toBe(true);
  });

  test('rejects invalid variable name (starts with number)', () => {
    expect(VariableDefinitionSchema.safeParse({ ...validVariable, name: '1baseUrl' }).success).toBe(
      false,
    );
  });

  test('rejects missing required fields', () => {
    expect(VariableDefinitionSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

// ─── Environment ───────────────────────────────────────────────────

describe('EnvironmentSchema', () => {
  const validEnv = {
    id: 'env-staging',
    name: 'Staging',
    tags: ['staging', 'read-only'],
  };

  test('accepts valid environment', () => {
    expect(EnvironmentSchema.safeParse(validEnv).success).toBe(true);
  });

  test('accepts production environment', () => {
    expect(EnvironmentSchema.safeParse({ ...validEnv, isProduction: true }).success).toBe(true);
  });

  test('rejects missing name', () => {
    expect(EnvironmentSchema.safeParse({ id: 'env-x' }).success).toBe(false);
  });
});

// ─── ApiErrorResponse ──────────────────────────────────────────────

describe('ApiErrorResponseSchema', () => {
  test('accepts valid error response', () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
        correlationId: 'abc123',
      }).success,
    ).toBe(true);
  });

  test('accepts error with field problems', () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        fieldProblems: [{ field: 'email', message: 'Invalid email format' }],
        correlationId: 'abc123',
      }).success,
    ).toBe(true);
  });

  test('rejects missing code', () => {
    expect(ApiErrorResponseSchema.safeParse({ message: 'Error', correlationId: 'x' }).success).toBe(
      false,
    );
  });
});
