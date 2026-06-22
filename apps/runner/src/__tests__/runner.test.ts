/**
 * Runner unit tests.
 *
 * Tests pure functions: variable resolution, JSONPath extraction,
 * sensitive data redaction, and event validation. Integration tests
 * against the Hermetic Fixture Server are separate.
 */

import type { FrozenStep } from '@tap/runner-protocol';
import { describe, expect, test } from 'vitest';
import {
  createVariableStore,
  evaluateAssertions,
  jsonPathGet,
  redactBody,
  redactHeaders,
  validateEvent,
} from '../index';

// ─── Variable Store ────────────────────────────────────────────────

describe('VariableStore', () => {
  test('resolves environment variables', () => {
    const vars = createVariableStore({ baseUrl: 'http://127.0.0.1:3800' });
    expect(vars.resolve('${baseUrl}/api/users')).toBe('http://127.0.0.1:3800/api/users');
  });

  test('resolves step-scoped variables', () => {
    const vars = createVariableStore();
    vars.set('userId', 'u-001', 'step');
    expect(vars.resolve('${userId}')).toBe('u-001');
  });

  test('resolves workflow-scoped variables', () => {
    const vars = createVariableStore();
    vars.set('accessToken', 'tok-abc123', 'workflow');
    expect(vars.resolve('Bearer ${accessToken}')).toBe('Bearer tok-abc123');
  });

  test('leaves unresolved variables in place', () => {
    const vars = createVariableStore();
    expect(vars.resolve('${nonexistent}')).toBe('${nonexistent}');
  });

  test('redacts sensitive variables in public snapshot', () => {
    const vars = createVariableStore();
    vars.set('apiKey', 'sk-secret-123', 'workflow', true);
    vars.set('username', 'testuser', 'workflow', false);

    const snapshot = vars.getPublicSnapshot();
    expect(snapshot['apiKey']!.valuePreview).toBe('***REDACTED***');
    expect(snapshot['username']!.valuePreview).toBe('testuser');
  });
});

// ─── JSONPath ──────────────────────────────────────────────────────

describe('jsonPathGet', () => {
  const fixture = {
    code: 0,
    data: {
      userId: 'u-001',
      name: '测试用户',
      email: 'test@sketch.dev',
      order: {
        orderId: 'ord-001',
        status: '待支付',
      },
    },
    items: [
      { name: 'Item A', price: 100 },
      { name: 'Item B', price: 200 },
    ],
  };

  test('extracts simple field', () => {
    expect(jsonPathGet(fixture, '$.code')).toBe(0);
  });

  test('extracts nested field', () => {
    expect(jsonPathGet(fixture, '$.data.userId')).toBe('u-001');
  });

  test('extracts deeply nested field', () => {
    expect(jsonPathGet(fixture, '$.data.order.orderId')).toBe('ord-001');
    expect(jsonPathGet(fixture, '$.data.order.status')).toBe('待支付');
  });

  test('returns undefined for missing path', () => {
    expect(jsonPathGet(fixture, '$.data.nonexistent')).toBeUndefined();
  });

  test('returns undefined for path through non-object', () => {
    expect(jsonPathGet(fixture, '$.code.nonexistent')).toBeUndefined();
  });

  test('extracts Chinese field names', () => {
    expect(jsonPathGet(fixture, '$.data.name')).toBe('测试用户');
  });

  test('extracts array items', () => {
    expect(jsonPathGet(fixture, '$.items')).toEqual(fixture.items);
  });
});

// ─── Sensitive Data Redaction ──────────────────────────────────────

describe('redactHeaders', () => {
  test('redacts Authorization header', () => {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer secret123' };
    const redacted = redactHeaders(headers);
    expect(redacted['Content-Type']).toBe('application/json');
    expect(redacted['Authorization']).toBe('***REDACTED***');
  });

  test('redacts Cookie header', () => {
    const headers = { Cookie: 'session=abc123' };
    const redacted = redactHeaders(headers);
    expect(redacted['Cookie']).toBe('***REDACTED***');
  });

  test('redacts case-insensitively', () => {
    const headers = { AUTHORIZATION: 'Bearer secret', 'X-API-KEY': 'key123' };
    const redacted = redactHeaders(headers);
    expect(redacted['AUTHORIZATION']).toBe('***REDACTED***');
    expect(redacted['X-API-KEY']).toBe('***REDACTED***');
  });

  test('leaves safe headers untouched', () => {
    const headers = { 'Content-Type': 'application/json', Accept: '*/*' };
    const redacted = redactHeaders(headers);
    expect(redacted).toEqual(headers);
  });
});

describe('redactBody', () => {
  test('redacts password field in JSON body', () => {
    const body = { name: 'test', password: 'secret123' };
    const redacted = redactBody(body);
    expect(redacted).not.toContain('secret123');
    expect(redacted).toContain('***REDACTED***');
  });

  test('redacts token field in JSON body', () => {
    const body = { token: 'abc-secret-token', data: 'safe' };
    const redacted = redactBody(body);
    expect(redacted).not.toContain('abc-secret-token');
    expect(redacted).toContain('***REDACTED***');
    expect(redacted).toContain('safe');
  });

  test('redacts nested sensitive fields', () => {
    const body = { user: { name: 'test', accessToken: 'tok-123', refreshToken: 'rt-456' } };
    const redacted = redactBody(body);
    expect(redacted).not.toContain('tok-123');
    expect(redacted).not.toContain('rt-456');
    expect(redacted).toContain('test');
  });

  test('handles non-JSON body', () => {
    expect(redactBody('plain text')).toBe('plain text');
    expect(redactBody(null)).toBeUndefined();
  });
});

// ─── Assertion Evaluation ──────────────────────────────────────────

describe('evaluateAssertions', () => {
  const baseStep: FrozenStep = {
    stepId: 'test-step',
    sequence: 0,
    method: 'GET',
    urlTemplate: 'http://example.com/api',
    assertions: [],
    maxRetries: 0,
    retryBaseDelayMs: 1000,
    retryBackoffMultiplier: 2,
    retryOnNetworkError: true,
    onFailure: 'stop',
    sideEffect: 'read-only',
    enabled: true,
    timeoutMs: 30000,
  };

  const response = {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-123' },
    body: { code: 0, data: { userId: 'u-001', name: '测试用户' }, message: 'success' },
    durationMs: 45,
  };

  test('status assertion passes', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'status' as const,
          operator: 'equals' as const,
          expected: 200,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('status assertion fails', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'status' as const,
          operator: 'equals' as const,
          expected: 201,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(false);
  });

  test('jsonPath exists assertion passes', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'jsonPath' as const,
          path: '$.data.userId',
          operator: 'exists' as const,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('jsonPath notExists assertion passes', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'jsonPath' as const,
          path: '$.data.password',
          operator: 'notExists' as const,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('jsonPath equals assertion with Chinese values', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'jsonPath' as const,
          path: '$.data.name',
          operator: 'equals' as const,
          expected: '测试用户',
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('jsonPath equals assertion fails with wrong value', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'jsonPath' as const,
          path: '$.data.name',
          operator: 'equals' as const,
          expected: '错误的用户',
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(false);
  });

  test('body contains assertion passes', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'body' as const,
          operator: 'contains' as const,
          expected: 'success',
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('responseTime assertion passes under threshold', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'responseTime' as const,
          operator: 'lessThan' as const,
          expected: 1000,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('header assertion passes', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'header' as const,
          path: 'x-request-id',
          operator: 'exists' as const,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(true);
  });

  test('warning severity does not block', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'status' as const,
          operator: 'equals' as const,
          expected: 201,
          severity: 'warn' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.severity).toBe('warn');
  });

  test('multiple assertions evaluated independently', () => {
    const step = {
      ...baseStep,
      assertions: [
        {
          id: 'a1',
          target: 'status' as const,
          operator: 'equals' as const,
          expected: 200,
          severity: 'block' as const,
        },
        {
          id: 'a2',
          target: 'jsonPath' as const,
          path: '$.code',
          operator: 'equals' as const,
          expected: 0,
          severity: 'block' as const,
        },
        {
          id: 'a3',
          target: 'jsonPath' as const,
          path: '$.data.userId',
          operator: 'exists' as const,
          severity: 'block' as const,
        },
      ],
    };
    const results = evaluateAssertions(step, response);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ─── Event Validation ─────────────────────────────────────────────

describe('validateEvent', () => {
  test('validates RunStarted event', () => {
    const event = {
      runId: 'run-001',
      sequence: 1,
      timestamp: '2026-06-21T10:00:00.000Z',
      attempt: 1,
      stepId: 'run',
      eventType: 'run.started',
      runnerId: 'runner-1',
      runnerVersion: '0.1.0',
    };
    const validated = validateEvent(event);
    expect(validated).not.toBeNull();
    if (validated && validated.eventType === 'run.started') {
      expect(validated.runnerId).toBe('runner-1');
    }
  });

  test('validates RunFinished event', () => {
    const event = {
      runId: 'run-001',
      sequence: 100,
      timestamp: '2026-06-21T10:00:05.000Z',
      attempt: 1,
      stepId: 'run',
      eventType: 'run.finished',
      terminalState: 'passed',
      totalSteps: 5,
      stepsPassed: 5,
      stepsFailed: 0,
      stepsSkipped: 0,
      totalDurationMs: 5000,
    };
    const validated = validateEvent(event);
    expect(validated).not.toBeNull();
    if (validated && validated.eventType === 'run.finished') {
      expect(validated.terminalState).toBe('passed');
    }
  });

  test('rejects event with missing eventType', () => {
    const event = {
      runId: 'run-001',
      sequence: 1,
      timestamp: '2026-06-21T10:00:00.000Z',
      attempt: 1,
      stepId: 'step-1',
    };
    const validated = validateEvent(event);
    expect(validated).toBeNull();
  });

  test('validates all event types', () => {
    const events = [
      {
        eventType: 'step.started',
        runId: 'r1',
        sequence: 1,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        resolvedUrl: 'http://example.com',
      },
      {
        eventType: 'request.prepared',
        runId: 'r1',
        sequence: 2,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        headers: {},
        method: 'GET',
        url: 'http://example.com',
      },
      {
        eventType: 'request.sent',
        runId: 'r1',
        sequence: 3,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        sentAt: '2026-06-21T10:00:00.000Z',
      },
      {
        eventType: 'response.received',
        runId: 'r1',
        sequence: 4,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        statusCode: 200,
        headers: {},
        bodySizeBytes: 100,
        durationMs: 50,
      },
      {
        eventType: 'assertion.evaluated',
        runId: 'r1',
        sequence: 5,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        assertionId: 'a1',
        passed: true,
        severity: 'block',
      },
      {
        eventType: 'step.finished',
        runId: 'r1',
        sequence: 6,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        status: 'passed',
        totalDurationMs: 100,
        assertionsPassed: 1,
        assertionsFailed: 0,
      },
      {
        eventType: 'step.retried',
        runId: 'r1',
        sequence: 7,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 2,
        stepId: 's1',
        reason: 'timeout',
        retryNumber: 1,
      },
      {
        eventType: 'variable.extracted',
        runId: 'r1',
        sequence: 8,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        name: 'userId',
        sensitive: false,
        source: 'body',
      },
      {
        eventType: 'teardown.started',
        runId: 'r1',
        sequence: 9,
        timestamp: '2026-06-21T10:00:00.000Z',
        attempt: 1,
        stepId: 's1',
        reason: 'workflow-completed',
      },
    ];

    for (const event of events) {
      const validated = validateEvent(event);
      expect(validated).not.toBeNull();
    }
  });
});
