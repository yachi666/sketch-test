/**
 * Workflow Compiler unit tests.
 *
 * Tests the core invariant: WorkflowDefinition (editor DSL) → ExecutionPlan.
 * Pure memory tests — no database dependency.
 */
import { describe, expect, test } from 'vitest';
import { compileWorkflow, type WorkflowDefInput, type WorkflowStepDef } from '../workflow-compiler';

// ─── Helpers ────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkflowStepDef> = {}): WorkflowStepDef {
  return {
    id: 'step-1',
    name: 'Test Step',
    method: 'GET',
    url: 'http://localhost/api/test',
    ...overrides,
  };
}

function makeDef(
  steps: WorkflowStepDef[],
  overrides: Partial<WorkflowDefInput> = {},
): WorkflowDefInput {
  return { name: 'Test Workflow', steps, ...overrides };
}

// ─── Basic Structure Validation ─────────────────────────────────────

describe('compileWorkflow: structure validation', () => {
  test('rejects empty steps array', async () => {
    const result = await compileWorkflow(makeDef([]));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('at least one step'),
      }),
    );
  });

  test('rejects workflow with > 50 steps', async () => {
    const steps = Array.from({ length: 51 }, (_, i) =>
      makeStep({ id: `step-${i}`, method: 'GET', url: `/api/${i}` }),
    );
    const result = await compileWorkflow(makeDef(steps));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('maximum is 50'),
      }),
    );
  });

  test('allows exactly 50 steps', async () => {
    const steps = Array.from({ length: 50 }, (_, i) =>
      makeStep({ id: `step-${i}`, method: 'GET', url: `/api/${i}` }),
    );
    const result = await compileWorkflow(makeDef(steps));
    expect(result.success).toBe(true);
  });

  test('rejects duplicate step IDs', async () => {
    const result = await compileWorkflow(
      makeDef([makeStep({ id: 'dup' }), makeStep({ id: 'dup', method: 'POST', url: '/other' })]),
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Duplicate step ID'),
      }),
    );
  });

  test('rejects step with neither useTest nor method', async () => {
    const result = await compileWorkflow(makeDef([{ id: 'empty', name: 'Empty' }]));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        stepId: 'empty',
        message: expect.stringContaining('neither useTest nor method'),
      }),
    );
  });

  test('rejects teardown > 20 steps', async () => {
    const teardown = Array.from({ length: 21 }, (_, i) => ({
      id: `td-${i}`,
      name: `Cleanup ${i}`,
      method: 'DELETE',
      url: `/api/${i}`,
    }));
    const result = await compileWorkflow(makeDef([makeStep()], { teardown }));
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('maximum is 20'),
      }),
    );
  });
});

// ─── Variable Reference & Dependency Analysis ───────────────────────

describe('compileWorkflow: variable dependencies', () => {
  test('detects forward reference (step references var from later step)', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'GET',
          url: '${step-2.userId}', // references step-2 which executes later
        }),
        makeStep({
          id: 'step-2',
          method: 'POST',
          url: '/api/users',
          extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
        }),
      ]),
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        stepId: 'step-1',
        message: expect.stringContaining('after it'),
      }),
    );
  });

  test('allows backward reference (step references var from earlier step)', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'POST',
          url: '/api/users',
          extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
        }),
        makeStep({
          id: 'step-2',
          method: 'GET',
          url: '${userId}', // references earlier step's production
        }),
      ]),
    );
    expect(result.success).toBe(true);
  });

  test('environment-scoped variables are always allowed', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'GET',
          url: '${env.baseUrl}/api/users',
          headers: { Authorization: 'Bearer ${env.apiToken}' },
        }),
      ]),
    );
    expect(result.success).toBe(true);
  });

  test('warns about unresolved variable (not produced by any step)', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'GET',
          url: '${unknownVar}',
        }),
      ]),
    );
    // Should succeed but with warning
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('not produced by any step'),
      }),
    );
    expect(result.success).toBe(true);
  });

  test('variable references in body and headers are also checked', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'POST',
          url: '/api/data',
          headers: { 'X-User': '${laterStep.userId}' },
          body: { ownerId: '${laterStep.userId}' },
        }),
        makeStep({
          id: 'laterStep',
          method: 'POST',
          url: '/api/users',
          extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
        }),
      ]),
    );
    expect(result.success).toBe(false);
    // Both url and body should contain forward references
    const forwardRefErrors = result.diagnostics.filter(
      (d) => d.severity === 'error' && d.message.includes('after'),
    );
    expect(forwardRefErrors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Cycle Detection ────────────────────────────────────────────────

describe('compileWorkflow: cycle detection', () => {
  test('detects simple cycle: step-1 → step-2 → step-1', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'GET',
          url: '${step-2.userId}',
          extract: [{ name: 'token', source: 'body', expression: '$.token' }],
        }),
        makeStep({
          id: 'step-2',
          method: 'POST',
          url: '${token}', // depends on step-1, but step-1 depends on step-2
          extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
        }),
      ]),
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Cycle detected'),
      }),
    );
  });

  test('no false positive for linear chain', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'step-1',
          method: 'POST',
          url: '/api/login',
          extract: [{ name: 'token', source: 'body', expression: '$.token' }],
        }),
        makeStep({
          id: 'step-2',
          method: 'GET',
          url: '/api/me',
          headers: { Authorization: 'Bearer ${token}' },
          extract: [{ name: 'userId', source: 'body', expression: '$.id' }],
        }),
        makeStep({
          id: 'step-3',
          method: 'GET',
          url: '/api/users/${userId}',
        }),
      ]),
    );
    expect(result.success).toBe(true);
  });
});

// ─── Compilation Output ─────────────────────────────────────────────

describe('compileWorkflow: compilation output', () => {
  test('produces a valid ExecutionPlan with deterministic hash', async () => {
    const result1 = await compileWorkflow(makeDef([makeStep()]));
    const result2 = await compileWorkflow(makeDef([makeStep()]));

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    expect(result1.plan).toBeDefined();
    expect(result2.plan).toBeDefined();

    // Same input → same hash
    expect(result1.plan!.planHash).toBe(result2.plan!.planHash);
    expect(result1.plan!.schemaVersion).toBe('sketch-test.runner-protocol/v1');
    expect(result1.plan!.steps).toHaveLength(1);
  });

  test('sets explicit defaults on FrozenSteps', async () => {
    const result = await compileWorkflow(makeDef([makeStep()]));
    expect(result.success).toBe(true);
    const step = result.plan!.steps[0]!;
    expect(step.maxRetries).toBe(0);
    expect(step.timeoutMs).toBe(30_000);
    expect(step.enabled).toBe(true);
    expect(step.onFailure).toBe('stop');
    expect(step.sideEffect).toBe('read-only');
  });

  test('honors explicit step-level overrides', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          maxRetries: 3,
          timeoutMs: 60_000,
          onFailure: 'skip',
          sideEffect: 'cleanup-required',
          enabled: false,
        }),
      ]),
    );
    expect(result.success).toBe(true);
    const step = result.plan!.steps[0]!;
    expect(step.maxRetries).toBe(3);
    expect(step.timeoutMs).toBe(60_000);
    expect(step.onFailure).toBe('skip');
    expect(step.sideEffect).toBe('cleanup-required');
    expect(step.enabled).toBe(false);
  });

  test('caps maxRetries at 10', async () => {
    const result = await compileWorkflow(makeDef([makeStep({ maxRetries: 999 })]));
    expect(result.success).toBe(true);
    expect(result.plan!.steps[0]!.maxRetries).toBe(10);
  });

  test('caps timeoutMs at 300000 (5 min)', async () => {
    const result = await compileWorkflow(makeDef([makeStep({ timeoutMs: 999_999 })]));
    expect(result.success).toBe(true);
    expect(result.plan!.steps[0]!.timeoutMs).toBe(300_000);
  });

  test('invalid onFailure defaults to stop', async () => {
    const result = await compileWorkflow(makeDef([makeStep({ onFailure: 'retry-forever' })]));
    expect(result.success).toBe(true);
    expect(result.plan!.steps[0]!.onFailure).toBe('stop');
  });

  test('steps are sequenced in order', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({ id: 'a', method: 'GET', url: '/1' }),
        makeStep({ id: 'b', method: 'POST', url: '/2' }),
        makeStep({ id: 'c', method: 'DELETE', url: '/3' }),
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.plan!.steps.map((s) => s.sequence)).toEqual([0, 1, 2]);
  });

  test('includes assertions in compiled output', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          assertions: [
            { target: 'status', operator: 'equals', expected: 200 },
            { target: 'jsonPath', operator: 'exists', expected: '$.data' },
          ],
        }),
      ]),
    );
    expect(result.success).toBe(true);
    const assertions = result.plan!.steps[0]!.assertions;
    expect(assertions).toHaveLength(2);
    expect(assertions[0]!.target).toBe('status');
    expect(assertions[0]!.expected).toBe(200);
    expect(assertions[1]!.target).toBe('jsonPath');
  });

  test('includes extractions in compiled output', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          extract: [
            { name: 'userId', source: 'body', expression: '$.id', scope: 'workflow' },
            { name: 'token', source: 'header', expression: 'authorization', scope: 'step' },
          ],
        }),
      ]),
    );
    expect(result.success).toBe(true);
    const extractions = result.plan!.steps[0]!.extractions!;
    expect(extractions).toHaveLength(2);
    expect(extractions[0]!.name).toBe('userId');
    expect(extractions[0]!.scope).toBe('workflow');
    expect(extractions[1]!.name).toBe('token');
  });

  test('compiles teardown phase', async () => {
    const result = await compileWorkflow(
      makeDef([makeStep()], {
        teardown: [{ id: 'cleanup', name: 'Cleanup', method: 'DELETE', url: '/api/data' }],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.plan!.teardown).toBeDefined();
    expect(result.plan!.teardown!.strategy).toBe('always');
    expect(result.plan!.teardown!.steps).toHaveLength(1);
    expect(result.plan!.teardown!.steps[0]!.method).toBe('DELETE');
  });

  test('teardown step has cleanup-required sideEffect', async () => {
    const result = await compileWorkflow(
      makeDef([makeStep()], {
        teardown: [{ id: 'td', name: 'TD', method: 'DELETE', url: '/api/x' }],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.plan!.teardown!.steps[0]!.sideEffect).toBe('cleanup-required');
  });

  test('teardown maxRetries capped at 3', async () => {
    const result = await compileWorkflow(
      makeDef([makeStep()], {
        teardown: [{ id: 'td', name: 'TD', method: 'DELETE', url: '/api/x', maxRetries: 10 }],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.plan!.teardown!.steps[0]!.maxRetries).toBe(3);
  });

  test('disables teardown step when enabled: false', async () => {
    const result = await compileWorkflow(
      makeDef([makeStep()], {
        teardown: [{ id: 'td', name: 'TD', method: 'DELETE', url: '/api/x', enabled: false }],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.plan!.teardown!.steps[0]!.enabled).toBe(false);
  });
});

// ─── Test Reference Resolution ──────────────────────────────────────

describe('compileWorkflow: test reference resolution', () => {
  test('warns when useTest has no resolver but step has inline fallback', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({ id: 'ref-step', useTest: 'tcv_missing', method: 'GET', url: '/fallback' }),
      ]),
    );
    // Should succeed because inline fields provide fallback
    expect(result.success).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('no resolver'),
      }),
    );
  });

  test('resolves test references via provided resolver', async () => {
    const resolveTest = async (id: string) => {
      if (id === 'tcv_login') {
        return {
          method: 'POST',
          url: '/api/login',
          headers: { 'Content-Type': 'application/json' },
          body: { username: 'admin', password: 'secret' },
          assertions: [
            { target: 'status', operator: 'equals', expected: 200, description: 'Login OK' },
          ],
          extract: [{ name: 'accessToken', source: 'body', expression: '$.token' }],
          sideEffect: 'read-only',
        };
      }
      return null;
    };

    const result = await compileWorkflow(
      makeDef([{ id: 'login', name: 'Login', useTest: 'tcv_login' }]),
      { resolveTest },
    );
    expect(result.success).toBe(true);
    const step = result.plan!.steps[0]!;
    expect(step.method).toBe('POST');
    expect(step.urlTemplate).toBe('/api/login');
    expect(step.originTestVersionId).toBe('tcv_login');
    expect(step.extractions![0]!.name).toBe('accessToken');
  });

  test('step-level overrides take precedence over resolved test', async () => {
    const resolveTest = async () => ({
      method: 'POST',
      url: '/api/default',
      assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
      sideEffect: 'read-only' as const,
    });

    const result = await compileWorkflow(
      makeDef([
        makeStep({
          id: 'override-step',
          useTest: 'tcv_any',
          url: '/api/custom', // override resolved URL
          headers: { 'X-Custom': 'yes' },
        }),
      ]),
      { resolveTest },
    );
    expect(result.success).toBe(true);
    const step = result.plan!.steps[0]!;
    expect(step.urlTemplate).toBe('/api/custom');
    expect(step.headers).toEqual({ 'X-Custom': 'yes' });
  });

  test('errors when resolved test is not found', async () => {
    const resolveTest = async () => null; // never finds anything
    const result = await compileWorkflow(
      makeDef([{ id: 'ghost', name: 'Ghost', useTest: 'tcv_nonexistent' }]),
      { resolveTest },
    );
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('not found'),
      }),
    );
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────

describe('compileWorkflow: edge cases', () => {
  test('extraction without assertion produces warning', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          extract: [{ name: 'data', source: 'body', expression: '$.data' }],
          // no assertions
        }),
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('extractions but no assertions'),
      }),
    );
  });

  test('extraction + useTest does NOT produce the no-assertions warning', async () => {
    const result = await compileWorkflow(
      makeDef([
        {
          id: 'ref-step',
          name: 'Ref Step',
          useTest: 'tcv_test',
          extract: [{ name: 'data', source: 'body', expression: '$.data' }],
        },
      ]),
    );
    // should NOT have the extraction-without-assertion warning for useTest steps
    const extractionWarnings = result.diagnostics.filter(
      (d) => d.severity === 'warning' && d.message.includes('extractions but no assertions'),
    );
    expect(extractionWarnings).toHaveLength(0);
  });

  test('disabled step still compiles', async () => {
    const result = await compileWorkflow(makeDef([makeStep({ enabled: false })]));
    expect(result.success).toBe(true);
    expect(result.plan!.steps[0]!.enabled).toBe(false);
  });

  test('workflow with only environment variables compiles without warnings', async () => {
    const result = await compileWorkflow(
      makeDef([
        makeStep({
          method: 'GET',
          url: '${env.baseUrl}/api/users',
          headers: { Authorization: 'Bearer ${env.token}' },
        }),
      ]),
    );
    expect(result.success).toBe(true);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
