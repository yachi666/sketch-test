/**
 * Golden tests for @sketch-test/runner-protocol.
 *
 * Validates ExecutionPlan, RunEvent discriminated union, and runner lifecycle schemas.
 * These are the contracts that the Runner and Control Plane must agree on.
 */
import { describe, expect, test } from 'vitest';
import {
  ExecutionPlanSchema,
  FrozenStepSchema,
  HeartbeatSchema,
  RunEventSchema,
  RunnerRegistrationSchema,
  RunStartedEventSchema,
  VALID_RUN_TRANSITIONS,
  WorkLeaseSchema,
} from '../index';

// ─── FrozenStep ────────────────────────────────────────────────────

describe('FrozenStepSchema', () => {
  const validStep = {
    stepId: 'step-001',
    sequence: 0,
    method: 'GET' as const,
    urlTemplate: '${env.baseUrl}/api/users',
    assertions: [
      { id: 'asrt-001', target: 'status' as const, operator: 'equals' as const, expected: 200 },
    ],
  };

  test('accepts valid step', () => {
    expect(FrozenStepSchema.safeParse(validStep).success).toBe(true);
  });

  test('rejects missing method', () => {
    const { method: _, ...rest } = validStep;
    expect(FrozenStepSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects invalid method', () => {
    expect(FrozenStepSchema.safeParse({ ...validStep, method: 'TRACE' }).success).toBe(false);
  });

  test('rejects negative maxRetries', () => {
    expect(FrozenStepSchema.safeParse({ ...validStep, maxRetries: -1 }).success).toBe(false);
  });

  test('accepts step with retry config', () => {
    expect(
      FrozenStepSchema.safeParse({
        ...validStep,
        maxRetries: 3,
        retryBaseDelayMs: 500,
        retryBackoffMultiplier: 2,
        retryOnStatuses: [500, 502, 503],
      }).success,
    ).toBe(true);
  });
});

// ─── ExecutionPlan ─────────────────────────────────────────────────

describe('ExecutionPlanSchema', () => {
  const validPlan = {
    schemaVersion: 'sketch-test.runner-protocol/v1' as const,
    planId: 'plan-001',
    planHash: 'a'.repeat(64),
    workflowVersionId: 'wf-v1',
    compiledAt: '2026-06-21T10:00:00.000Z',
    steps: [
      {
        stepId: 'step-001',
        sequence: 0,
        method: 'GET' as const,
        urlTemplate: '${env.baseUrl}/api/health',
        assertions: [
          { id: 'a-1', target: 'status' as const, operator: 'equals' as const, expected: 200 },
        ],
      },
    ],
  };

  test('accepts valid plan', () => {
    expect(ExecutionPlanSchema.safeParse(validPlan).success).toBe(true);
  });

  test('rejects empty steps', () => {
    expect(ExecutionPlanSchema.safeParse({ ...validPlan, steps: [] }).success).toBe(false);
  });

  test('rejects over 50 steps', () => {
    const step = validPlan.steps[0]!;
    expect(
      ExecutionPlanSchema.safeParse({ ...validPlan, steps: Array(51).fill(step) }).success,
    ).toBe(false);
  });

  test('rejects wrong schema version', () => {
    expect(ExecutionPlanSchema.safeParse({ ...validPlan, schemaVersion: 'v2' }).success).toBe(
      false,
    );
  });
});

// ─── RunEvent Discriminated Union ─────────────────────────────────

describe('RunEventSchema', () => {
  test('accepts run.started event', () => {
    const event = {
      runId: 'run-001',
      sequence: 1,
      timestamp: '2026-06-21T10:00:00.000Z',
      attempt: 1,
      stepId: 'run' as const,
      eventType: 'run.started' as const,
      runnerId: 'runner-local',
      runnerVersion: '0.1.0',
    };
    expect(RunEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts step.finished event', () => {
    const event = {
      runId: 'run-001',
      sequence: 10,
      timestamp: '2026-06-21T10:00:01.000Z',
      attempt: 1,
      stepId: 'step-001',
      eventType: 'step.finished' as const,
      status: 'passed' as const,
      totalDurationMs: 150,
      assertionsPassed: 3,
      assertionsFailed: 0,
      retries: 0,
    };
    expect(RunEventSchema.safeParse(event).success).toBe(true);
  });

  test('accepts step.finished with error', () => {
    const event = {
      runId: 'run-001',
      sequence: 10,
      timestamp: '2026-06-21T10:00:01.000Z',
      attempt: 1,
      stepId: 'step-001',
      eventType: 'step.finished' as const,
      status: 'error' as const,
      totalDurationMs: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      retries: 0,
      error: { type: 'timeout' as const, message: 'Request timed out after 30000ms' },
    };
    expect(RunEventSchema.safeParse(event).success).toBe(true);
  });

  test('rejects event with invalid eventType', () => {
    const event = {
      runId: 'run-001',
      sequence: 1,
      timestamp: '2026-06-21T10:00:00.000Z',
      attempt: 1,
      stepId: 'step-001',
      eventType: 'unknown.event',
    };
    expect(RunEventSchema.safeParse(event).success).toBe(false);
  });

  test('rejects event with negative sequence', () => {
    expect(
      RunStartedEventSchema.safeParse({
        runId: 'run-001',
        sequence: 0,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 'run' as const,
        eventType: 'run.started' as const,
        runnerId: 'runner',
        runnerVersion: '0.1.0',
      }).success,
    ).toBe(false);
  });
});

// ─── Run State Machine ────────────────────────────────────────────

describe('VALID_RUN_TRANSITIONS', () => {
  test('queued can transition to leased or cancelled', () => {
    expect(VALID_RUN_TRANSITIONS['queued']).toContain('leased');
    expect(VALID_RUN_TRANSITIONS['queued']).toContain('cancelled');
  });

  test('terminal states have no transitions', () => {
    expect(VALID_RUN_TRANSITIONS['passed']).toEqual([]);
    expect(VALID_RUN_TRANSITIONS['failed']).toEqual([]);
    expect(VALID_RUN_TRANSITIONS['cancelled']).toEqual([]);
  });
});

// ─── Runner Lifecycle ──────────────────────────────────────────────

describe('RunnerRegistrationSchema', () => {
  test('accepts valid registration', () => {
    expect(
      RunnerRegistrationSchema.safeParse({
        runnerId: 'runner-us-east-1',
        capabilities: {
          labels: ['us-east-1', 'internal'],
          maxConcurrency: 5,
          protocolVersions: ['1.0.0'],
          runnerVersion: '0.1.0',
          runtimeVersion: 'Node.js 24.0.0',
        },
      }).success,
    ).toBe(true);
  });
});

describe('HeartbeatSchema', () => {
  test('accepts valid heartbeat', () => {
    expect(
      HeartbeatSchema.safeParse({
        runnerId: 'runner-us-east-1',
        activeTasks: 3,
        timestamp: '2026-06-21T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('WorkLeaseSchema', () => {
  test('accepts valid lease', () => {
    expect(
      WorkLeaseSchema.safeParse({
        leaseId: 'lease-001',
        runId: 'run-001',
        planRef: 's3://sketchtest-plans/plan-001.json',
        expiresAt: '2026-06-21T10:05:00.000Z',
      }).success,
    ).toBe(true);
  });
});
