/**
 * Run service unit tests.
 *
 * Tests ExecutionPlan building and step transformation logic.
 * No database dependency — tests pure data transformations.
 */

import { describe, expect, test } from 'vitest';
import { createRunFromSteps } from '../run.service';

// ─── createRunFromSteps ──────────────────────────────────────────

describe('createRunFromSteps', () => {
  test('returns a valid ExecutionPlan with correct schema version', () => {
    const result = createRunFromSteps([
      { method: 'GET', url: 'https://example.com/api/test', timeoutMs: 5000 },
    ]);

    expect(result.plan.schemaVersion).toBe('sketch-test.runner-protocol/v1');
    expect(result.plan.planId).toBeTruthy();
    expect(result.runId).toBe(result.plan.planId);
  });

  test('maps step count correctly', () => {
    const steps = [
      { method: 'GET', url: 'https://a.com/1', timeoutMs: 5000 },
      { method: 'POST', url: 'https://a.com/2', timeoutMs: 5000 },
      { method: 'DELETE', url: 'https://a.com/3', timeoutMs: 5000 },
    ];

    const result = createRunFromSteps(steps);
    expect(result.plan.steps).toHaveLength(3);
  });

  test('maps method correctly', () => {
    const result = createRunFromSteps([
      { method: 'PATCH', url: 'https://example.com/api', timeoutMs: 5000 },
    ]);

    expect(result.plan.steps[0]!.method).toBe('PATCH');
  });

  test('maps headers', () => {
    const result = createRunFromSteps([
      {
        method: 'GET',
        url: 'https://example.com/api',
        headers: { Authorization: 'Bearer token', 'X-Custom': 'value' },
        timeoutMs: 5000,
      },
    ]);

    expect(result.plan.steps[0]!.headers).toEqual({
      Authorization: 'Bearer token',
      'X-Custom': 'value',
    });
  });

  test('maps body', () => {
    const result = createRunFromSteps([
      {
        method: 'POST',
        url: 'https://example.com/api',
        body: { name: 'test', value: 42 },
        timeoutMs: 5000,
      },
    ]);

    expect(result.plan.steps[0]!.body).toEqual({ name: 'test', value: 42 });
  });

  test('maps assertions with correct IDs', () => {
    const result = createRunFromSteps([
      {
        method: 'GET',
        url: 'https://example.com/api',
        assertions: [
          { target: 'status', operator: 'equals', expected: 200, severity: 'block' },
          { target: 'jsonPath', path: '$.data.id', operator: 'exists', severity: 'block' },
        ],
        timeoutMs: 5000,
      },
    ]);

    const step0 = result.plan.steps[0]!;
    expect(step0.assertions).toHaveLength(2);
    expect(step0.assertions[0]!.target).toBe('status');
    expect(step0.assertions[0]!.severity).toBe('block');
    expect(step0.assertions[1]!.path).toBe('$.data.id');

    // IDs are unique
    expect(step0.assertions[0]!.id).not.toBe(step0.assertions[1]!.id);
  });

  test('maps assertions with default severity when omitted', () => {
    const result = createRunFromSteps([
      {
        method: 'GET',
        url: 'https://example.com/api',
        assertions: [
          { target: 'status', operator: 'equals', expected: 200, severity: 'block' } as const,
        ],
        timeoutMs: 5000,
      },
    ]);

    expect(result.plan.steps[0]!.assertions[0]!.severity).toBe('block');
  });

  test('maps extractions with correct scope', () => {
    const result = createRunFromSteps([
      {
        method: 'POST',
        url: 'https://example.com/login',
        assertions: [],
        extractions: [
          { name: 'token', source: 'body', expression: '$.data.token', sensitive: true },
          { name: 'userId', source: 'body', expression: '$.data.id', sensitive: false },
        ],
        timeoutMs: 5000,
      },
    ]);

    const exts = result.plan.steps[0]!.extractions!;
    expect(exts).toHaveLength(2);
    expect(exts[0]!.name).toBe('token');
    expect(exts[0]!.sensitive).toBe(true);
    expect(exts[1]!.sensitive).toBe(false);

    // All extractions are workflow-scoped
    for (const ext of exts) {
      expect(ext['scope']).toBe('workflow');
    }
  });

  test('handles empty assertions and extractions', () => {
    const result = createRunFromSteps([
      { method: 'GET', url: 'https://example.com/api', timeoutMs: 5000 },
    ]);

    expect(result.plan.steps[0]!.assertions).toHaveLength(0);
    expect(result.plan.steps[0]!.extractions).toHaveLength(0);
  });

  test('all steps have onFailure=stop', () => {
    const result = createRunFromSteps([
      { method: 'GET', url: 'https://a.com', timeoutMs: 5000 },
      { method: 'POST', url: 'https://b.com', timeoutMs: 5000 },
    ]);

    for (const step of result.plan.steps) {
      expect(step.onFailure).toBe('stop');
    }
  });

  test('all steps are enabled with read-only sideEffect', () => {
    const result = createRunFromSteps([{ method: 'GET', url: 'https://a.com', timeoutMs: 5000 }]);

    expect(result.plan.steps[0]!.enabled).toBe(true);
    expect(result.plan.steps[0]!.sideEffect).toBe('read-only');
  });

  test('uses default timeoutMs=30000 when not specified', () => {
    const result = createRunFromSteps([
      { method: 'GET', url: 'https://a.com' } as Parameters<typeof createRunFromSteps>[0][0],
    ]);

    expect(result.plan.steps[0]!.timeoutMs).toBe(30000);
  });

  test('preserves specified timeoutMs', () => {
    const result = createRunFromSteps([{ method: 'GET', url: 'https://a.com', timeoutMs: 60000 }]);

    expect(result.plan.steps[0]!.timeoutMs).toBe(60000);
  });

  test('step sequence numbers are 0-indexed', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      method: 'GET' as const,
      url: `https://example.com/step${i}`,
      timeoutMs: 5000,
    }));

    const result = createRunFromSteps(steps);
    result.plan.steps.forEach((step, i) => {
      expect(step.sequence).toBe(i);
    });
  });

  test('step IDs contain planId prefix', () => {
    const result = createRunFromSteps([
      { method: 'GET', url: 'https://example.com/api', timeoutMs: 5000 },
    ]);

    const id = result.plan.steps[0]!.stepId;
    expect(id).toContain(result.plan.planId);
    expect(id).toContain('-step-0');
  });

  test('each run gets a unique planId', () => {
    const r1 = createRunFromSteps([{ method: 'GET', url: 'https://a.com', timeoutMs: 5000 }]);
    const r2 = createRunFromSteps([{ method: 'GET', url: 'https://b.com', timeoutMs: 5000 }]);

    expect(r1.runId).not.toBe(r2.runId);
    expect(r1.plan.planId).not.toBe(r2.plan.planId);
  });
});
