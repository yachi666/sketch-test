/**
 * Golden tests for @sketch-test/workflow-dsl.
 *
 * Validates WorkflowDefinition, steps, teardown, and version schemas.
 * These are the editor-format contracts consumed by the workflow editor.
 */
import { describe, expect, test } from 'vitest';
import {
  ConditionConfigSchema,
  FailureStrategySchema,
  PollConfigSchema,
  RetryConfigSchema,
  StepTestRefSchema,
  TeardownStepSchema,
  TeardownStrategySchema,
  WorkflowDefinitionSchema,
  WorkflowStepSchema,
  WorkflowVersionSchema,
} from '../index';

// ─── StepTestRef ───────────────────────────────────────────────────

describe('StepTestRefSchema', () => {
  test('accepts test-version ref', () => {
    expect(
      StepTestRefSchema.safeParse({
        kind: 'test-version',
        testVersionId: 'tcv-001',
      }).success,
    ).toBe(true);
  });

  test('accepts inline ref', () => {
    expect(
      StepTestRefSchema.safeParse({
        kind: 'inline',
        method: 'POST',
        url: '${env.baseUrl}/api/users',
      }).success,
    ).toBe(true);
  });

  test('rejects invalid kind', () => {
    expect(StepTestRefSchema.safeParse({ kind: 'unknown', url: '/api/test' }).success).toBe(false);
  });

  test('rejects test-version without testVersionId', () => {
    expect(StepTestRefSchema.safeParse({ kind: 'test-version' }).success).toBe(false);
  });
});

// ─── RetryConfig ───────────────────────────────────────────────────

describe('RetryConfigSchema', () => {
  test('accepts valid retry config', () => {
    expect(
      RetryConfigSchema.safeParse({
        maxRetries: 3,
        baseDelayMs: 1000,
        backoffMultiplier: 2,
        retryOnNetworkError: true,
      }).success,
    ).toBe(true);
  });

  test('caps maxRetries at 10', () => {
    expect(RetryConfigSchema.safeParse({ maxRetries: 11 }).success).toBe(false);
  });

  test('rejects negative baseDelayMs', () => {
    expect(RetryConfigSchema.safeParse({ baseDelayMs: -100 }).success).toBe(false);
  });
});

// ─── PollConfig ───────────────────────────────────────────────────

describe('PollConfigSchema', () => {
  test('accepts poll with maxDurationMs', () => {
    expect(
      PollConfigSchema.safeParse({
        maxDurationMs: 30000,
        untilExpression: '$.data.status === "completed"',
      }).success,
    ).toBe(true);
  });

  test('accepts poll with maxAttempts', () => {
    expect(
      PollConfigSchema.safeParse({
        maxAttempts: 10,
        untilExpression: '$.data.status === "completed"',
      }).success,
    ).toBe(true);
  });

  test('rejects poll without maxDurationMs or maxAttempts', () => {
    expect(
      PollConfigSchema.safeParse({
        untilExpression: '$.data.status === "completed"',
      }).success,
    ).toBe(false);
  });
});

// ─── ConditionConfig ───────────────────────────────────────────────

describe('ConditionConfigSchema', () => {
  test('accepts condition with skip on false', () => {
    expect(
      ConditionConfigSchema.safeParse({
        expression: '${steps.createUser.status} === 201',
        onFalse: 'skip',
      }).success,
    ).toBe(true);
  });

  test('defaults onFalse to skip', () => {
    const result = ConditionConfigSchema.safeParse({
      expression: '${env.skipTests} !== "true"',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.onFalse).toBe('skip');
    }
  });
});

// ─── FailureStrategy ───────────────────────────────────────────────

describe('FailureStrategySchema', () => {
  test('accepts all strategies', () => {
    for (const s of ['stop', 'skip', 'goto', 'teardown-and-stop']) {
      expect(FailureStrategySchema.safeParse(s).success).toBe(true);
    }
  });

  test('rejects invalid strategy', () => {
    expect(FailureStrategySchema.safeParse('retry').success).toBe(false);
  });
});

// ─── WorkflowStep ──────────────────────────────────────────────────

describe('WorkflowStepSchema', () => {
  const validStep = {
    id: 'step-001',
    name: 'Create user',
    useTest: { kind: 'inline' as const, method: 'POST' as const, url: '${env.baseUrl}/api/users' },
  };

  test('accepts valid step', () => {
    expect(WorkflowStepSchema.safeParse(validStep).success).toBe(true);
  });

  test('accepts step with goto label', () => {
    expect(
      WorkflowStepSchema.safeParse({
        ...validStep,
        onFailure: 'goto',
        gotoLabel: 'send-notification',
      }).success,
    ).toBe(true);
  });

  test('accepts step with all control logic', () => {
    expect(
      WorkflowStepSchema.safeParse({
        ...validStep,
        condition: { expression: '${env.runTests} === "true"' },
        retry: { maxRetries: 2 },
        poll: { maxDurationMs: 60000, untilExpression: '$.data.ready === true' },
        inputs: [{ target: 'userId', valueExpression: '${steps.login.userId}' }],
      }).success,
    ).toBe(true);
  });
});

// ─── Teardown ──────────────────────────────────────────────────────

describe('TeardownStrategySchema', () => {
  test('accepts all strategies', () => {
    for (const s of ['always', 'on-success', 'on-failure', 'never']) {
      expect(TeardownStrategySchema.safeParse(s).success).toBe(true);
    }
  });
});

describe('TeardownStepSchema', () => {
  test('accepts valid teardown step', () => {
    expect(
      TeardownStepSchema.safeParse({
        id: 'td-001',
        name: 'Cleanup test user',
        useTest: {
          kind: 'inline',
          method: 'DELETE',
          url: '${env.baseUrl}/api/users/${steps.createUser.userId}',
        },
      }).success,
    ).toBe(true);
  });

  test('caps maxRetries at 3', () => {
    expect(
      TeardownStepSchema.safeParse({
        id: 'td-001',
        name: 'Cleanup',
        useTest: { kind: 'inline', method: 'DELETE', url: '${env.baseUrl}/api/cleanup' },
        maxRetries: 5,
      }).success,
    ).toBe(false);
  });
});

// ─── WorkflowDefinition ────────────────────────────────────────────

describe('WorkflowDefinitionSchema', () => {
  const validWorkflow = {
    schemaVersion: 'sketch-test.workflow/v1' as const,
    id: 'wf-001',
    name: 'User registration flow',
    steps: [
      {
        id: 'step-001',
        name: 'Create user',
        useTest: {
          kind: 'inline' as const,
          method: 'POST' as const,
          url: '${env.baseUrl}/api/users',
        },
      },
    ],
  };

  test('accepts valid workflow', () => {
    expect(WorkflowDefinitionSchema.safeParse(validWorkflow).success).toBe(true);
  });

  test('rejects empty steps', () => {
    expect(WorkflowDefinitionSchema.safeParse({ ...validWorkflow, steps: [] }).success).toBe(false);
  });

  test('rejects over 50 steps', () => {
    expect(
      WorkflowDefinitionSchema.safeParse({
        ...validWorkflow,
        steps: Array(51).fill(validWorkflow.steps[0]),
      }).success,
    ).toBe(false);
  });

  test('accepts workflow with teardown', () => {
    expect(
      WorkflowDefinitionSchema.safeParse({
        ...validWorkflow,
        teardown: {
          strategy: 'always' as const,
          steps: [
            {
              id: 'td-001',
              name: 'Cleanup',
              useTest: {
                kind: 'inline' as const,
                method: 'DELETE' as const,
                url: '${env.baseUrl}/api/users/u-001',
              },
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});

// ─── WorkflowVersion ───────────────────────────────────────────────

describe('WorkflowVersionSchema', () => {
  test('accepts valid version', () => {
    expect(
      WorkflowVersionSchema.safeParse({
        id: 'wfv-001',
        entityId: 'wf-001',
        version: 1,
        publishedAt: '2026-06-21T10:00:00.000Z',
        publishedBy: 'user-1',
        contentHash: 'a'.repeat(64),
        definition: {
          schemaVersion: 'sketch-test.workflow/v1',
          id: 'wf-001',
          name: 'User registration flow',
          steps: [
            {
              id: 'step-001',
              name: 'Create user',
              useTest: { kind: 'inline', method: 'POST', url: '${env.baseUrl}/api/users' },
            },
          ],
        },
        planHash: 'b'.repeat(64),
      }).success,
    ).toBe(true);
  });
});
