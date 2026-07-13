import { ExecutionPlanSchema } from '@sketch-test/runner-protocol';
import { describe, expect, test } from 'vitest';
import { executionPlanContentHash } from '../../../shared/execution-plan-hash.js';
import { compileTestCaseVersionPlan, TestPlanCompileError } from '../test-plan-compiler.js';

function definition(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'sketch-test.test/v1',
    id: 'test-definition-1',
    name: 'Create user',
    request: {
      method: 'POST',
      url: '${env.baseUrl}/users',
      headers: { 'X-Trace': '${env.traceId}' },
      query: { verbose: 'true' },
      body: { mediaType: 'application/json', type: 'json', value: { name: 'Alice' } },
      auth: { type: 'bearer', token: '${env.token}' },
      timeoutMs: 5000,
    },
    assertions: [
      {
        id: 'created',
        target: 'status',
        statusCode: 201,
        operator: 'equals',
        severity: 'block',
      },
    ],
    extract: [
      {
        name: 'userId',
        source: 'body',
        expression: '$.id',
        scope: 'workflow',
        sensitive: false,
      },
    ],
    sideEffect: 'cleanup-required',
    ...overrides,
  };
}

describe('compileTestCaseVersionPlan', () => {
  test('freezes request, auth, assertions and provenance into a valid plan', () => {
    const plan = compileTestCaseVersionPlan('tcv-1', definition(), '2026-07-11T00:00:00.000Z');

    expect(ExecutionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan).not.toHaveProperty('workflowVersionId');
    expect(plan.testCaseVersionId).toBe('tcv-1');
    expect(plan.planHash).toBe(executionPlanContentHash(plan.steps));
    expect(plan.steps[0]).toMatchObject({
      headers: {
        Authorization: 'Bearer ${env.token}',
        'Content-Type': 'application/json',
        'X-Trace': '${env.traceId}',
      },
      query: { verbose: 'true' },
      body: { name: 'Alice' },
      assertions: [{ id: 'created', expected: 201 }],
      originTestVersionId: 'tcv-1',
    });
  });

  test('rejects invalid editor documents', () => {
    expect(() => compileTestCaseVersionPlan('tcv-1', { invalid: true })).toThrow(
      TestPlanCompileError,
    );
  });

  test('rejects auth that cannot be represented safely at Runner runtime', () => {
    const request = {
      ...(definition().request as Record<string, unknown>),
      auth: { type: 'basic', username: '${env.user}', password: '${env.password}' },
    };
    expect(() => compileTestCaseVersionPlan('tcv-1', definition({ request }))).toThrow(
      /cannot be frozen safely/,
    );
  });

  test('rejects body encodings the Runner cannot serialize correctly', () => {
    const request = {
      ...(definition().request as Record<string, unknown>),
      body: { mediaType: 'application/x-www-form-urlencoded', type: 'form', fields: { a: 'b' } },
    };
    expect(() => compileTestCaseVersionPlan('tcv-1', definition({ request }))).toThrow(
      /cannot be serialized safely/,
    );
  });
});
