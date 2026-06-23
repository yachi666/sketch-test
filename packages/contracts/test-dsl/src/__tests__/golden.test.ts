/**
 * Golden tests for @sketch-test/test-dsl.
 *
 * Validates TestDefinition, assertions, extraction, and version schemas.
 * These are the editor-format contracts consumed by the test authoring UI.
 */
import { describe, expect, test } from 'vitest';
import {
  AssertionSchema,
  AuthConfigSchema,
  GenerationSourceSchema,
  TestCaseVersionSchema,
  TestDefinitionSchema,
  TestDraftSchema,
} from '../index';

// ─── AuthConfig ────────────────────────────────────────────────────

describe('AuthConfigSchema', () => {
  test('accepts bearer auth', () => {
    expect(
      AuthConfigSchema.safeParse({
        type: 'bearer',
        token: '${env.accessToken}',
      }).success,
    ).toBe(true);
  });

  test('accepts api-key auth', () => {
    expect(
      AuthConfigSchema.safeParse({
        type: 'api-key',
        keyName: 'X-API-Key',
        keyValue: '${env.apiKey}',
        keyIn: 'header',
      }).success,
    ).toBe(true);
  });

  test('accepts none auth', () => {
    expect(AuthConfigSchema.safeParse({ type: 'none' }).success).toBe(true);
  });

  test('rejects invalid auth type', () => {
    expect(AuthConfigSchema.safeParse({ type: 'oauth2' }).success).toBe(false);
  });
});

// ─── Assertion ─────────────────────────────────────────────────────

describe('AssertionSchema', () => {
  test('accepts status assertion', () => {
    expect(
      AssertionSchema.safeParse({
        id: 'asrt-001',
        target: 'status',
        operator: 'equals',
        expected: 200,
      }).success,
    ).toBe(true);
  });

  test('accepts jsonPath assertion', () => {
    expect(
      AssertionSchema.safeParse({
        id: 'asrt-002',
        target: 'jsonPath',
        path: '$.data.userId',
        operator: 'exists',
      }).success,
    ).toBe(true);
  });

  test('accepts header assertion', () => {
    expect(
      AssertionSchema.safeParse({
        id: 'asrt-003',
        target: 'header',
        headerName: 'content-type',
        operator: 'contains',
        expected: 'application/json',
      }).success,
    ).toBe(true);
  });

  test('accepts regex assertion', () => {
    expect(
      AssertionSchema.safeParse({
        id: 'asrt-004',
        target: 'body',
        operator: 'matches',
        expected: '^\\{.*\\}$',
      }).success,
    ).toBe(true);
  });

  test('rejects missing id', () => {
    expect(AssertionSchema.safeParse({ target: 'status', operator: 'equals' }).success).toBe(false);
  });

  test('rejects invalid operator', () => {
    expect(
      AssertionSchema.safeParse({
        id: 'asrt-005',
        target: 'status',
        operator: 'invalidOp',
      }).success,
    ).toBe(false);
  });
});

// ─── TestDefinition ────────────────────────────────────────────────

describe('TestDefinitionSchema', () => {
  const validTest = {
    schemaVersion: 'sketch-test.test/v1' as const,
    id: 'test-001',
    name: 'GET /api/health returns 200',
    request: {
      method: 'GET' as const,
      url: '${env.baseUrl}/api/health',
    },
    assertions: [
      { id: 'a-1', target: 'status' as const, operator: 'equals' as const, expected: 200 },
    ],
  };

  test('accepts valid test definition', () => {
    expect(TestDefinitionSchema.safeParse(validTest).success).toBe(true);
  });

  test('accepts test with extraction', () => {
    expect(
      TestDefinitionSchema.safeParse({
        ...validTest,
        extract: [
          {
            name: 'userId',
            source: 'body',
            expression: '$.data.userId',
            scope: 'workflow',
          },
        ],
      }).success,
    ).toBe(true);
  });

  test('rejects wrong schema version', () => {
    expect(
      TestDefinitionSchema.safeParse({ ...validTest, schemaVersion: 'sketch-test.test/v2' })
        .success,
    ).toBe(false);
  });

  test('rejects missing request', () => {
    const { request: _, ...rest } = validTest;
    expect(TestDefinitionSchema.safeParse(rest).success).toBe(false);
  });

  test('accepts empty assertions (HTTP-only execution, no validation)', () => {
    expect(TestDefinitionSchema.safeParse({ ...validTest, assertions: [] }).success).toBe(true);
  });
});

// ─── TestCaseVersion ───────────────────────────────────────────────

describe('TestCaseVersionSchema', () => {
  test('accepts valid version', () => {
    expect(
      TestCaseVersionSchema.safeParse({
        id: 'tcv-001',
        entityId: 'test-001',
        version: 1,
        publishedAt: '2026-06-21T10:00:00.000Z',
        publishedBy: 'user-1',
        contentHash: 'a'.repeat(64),
        definition: {
          schemaVersion: 'sketch-test.test/v1',
          id: 'test-001',
          name: 'Health check',
          request: { method: 'GET', url: '${env.baseUrl}/api/health' },
          assertions: [{ id: 'a-1', target: 'status', operator: 'equals', expected: 200 }],
        },
        approved: true,
        validationStatus: 'stable-pass',
      }).success,
    ).toBe(true);
  });
});

// ─── TestDraft ─────────────────────────────────────────────────────

describe('TestDraftSchema', () => {
  test('accepts valid draft', () => {
    expect(
      TestDraftSchema.safeParse({
        id: 'draft-001',
        testCaseId: 'test-001',
        definition: {
          schemaVersion: 'sketch-test.test/v1',
          id: 'test-001',
          name: 'Draft test',
          request: { method: 'GET', url: '${env.baseUrl}/api/health' },
          assertions: [{ id: 'a-1', target: 'status', operator: 'equals', expected: 200 }],
        },
        expectedRevision: 0,
      }).success,
    ).toBe(true);
  });
});

// ─── GenerationSource ──────────────────────────────────────────────

describe('GenerationSourceSchema', () => {
  test('accepts AI generation source', () => {
    expect(
      GenerationSourceSchema.safeParse({
        strategy: 'ai-code-enhanced',
        apiVersionId: 'api-v1',
        endpointIds: ['endpoint-001'],
        modelInfo: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          promptVersion: '1.0.0',
          inputHash: 'a'.repeat(64),
        },
        confidence: 'high',
      }).success,
    ).toBe(true);
  });

  test('accepts schema-based generation source', () => {
    expect(
      GenerationSourceSchema.safeParse({
        strategy: 'schema-positive',
        apiVersionId: 'api-v1',
        endpointIds: ['endpoint-001'],
        schemaPaths: ['$.paths./users.get'],
        confidence: 'certain',
      }).success,
    ).toBe(true);
  });
});
