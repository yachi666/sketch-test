/**
 * Report service unit tests.
 *
 * Tests run report aggregation: step grouping, status inference, duration extraction.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

// ─── Mock pool ─────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../db/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

import { getRunReport } from '../report.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-001',
    api_version_id: 'av-001',
    status: 'passed',
    runner_id: 'rnr-001',
    claimed_at: '2026-06-24T10:00:00Z',
    created_at: '2026-06-24T09:00:00Z',
    finished_at: '2026-06-24T10:05:00Z',
    ...overrides,
  };
}

function makeStepEvent(
  stepIndex: number,
  eventType: string,
  payload: Record<string, unknown> = {},
  created_at = '2026-06-24T10:00:00Z',
) {
  return {
    step_index: stepIndex,
    event_type: eventType,
    payload_json: payload,
    created_at,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('getRunReport', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns null when run is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getRunReport('non-existent');
    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('returns run info with no steps when run exists but has no events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getRunReport('run-001');

    expect(result).not.toBeNull();
    expect(result!.run.id).toBe('run-001');
    expect(result!.run.status).toBe('passed');
    expect(result!.steps).toEqual([]);
  });

  test('groups events by step_index', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(0, 'step.started'),
        makeStepEvent(0, 'step.finished', { status: 'passed', totalDurationMs: 100 }),
        makeStepEvent(1, 'step.started'),
        makeStepEvent(1, 'step.finished', { status: 'failed', totalDurationMs: 200 }),
      ],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps).toHaveLength(2);
    expect(result!.steps[0]!.stepIndex).toBe(0);
    expect(result!.steps[0]!.status).toBe('passed');
    expect(result!.steps[0]!.durationMs).toBe(100);
    expect(result!.steps[1]!.stepIndex).toBe(1);
    expect(result!.steps[1]!.status).toBe('failed');
    expect(result!.steps[1]!.durationMs).toBe(200);
  });

  test('sort steps by step_index even if events arrive out of order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(2, 'step.finished', { status: 'passed' }),
        makeStepEvent(0, 'step.finished', { status: 'passed' }),
        makeStepEvent(1, 'step.finished', { status: 'passed' }),
      ],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
  });

  test('inferStepStatus returns unknown when no step.finished event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeStepEvent(0, 'step.started')],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.status).toBe('unknown');
    expect(result!.steps[0]!.durationMs).toBeUndefined();
  });

  test('inferStepStatus uses the LAST step.finished event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(0, 'step.finished', { status: 'passed' }, '2026-06-24T10:00:00Z'),
        makeStepEvent(0, 'step.finished', { status: 'failed' }, '2026-06-24T10:00:01Z'),
      ],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.status).toBe('failed');
  });

  test('inferStepStatus returns unknown when payload has no status field', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeStepEvent(0, 'step.finished', {}, '2026-06-24T10:00:00Z')],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.status).toBe('unknown');
  });

  test('inferStepDuration returns undefined when payload has no totalDurationMs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeStepEvent(0, 'step.finished', { status: 'passed' }, '2026-06-24T10:00:00Z')],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.durationMs).toBeUndefined();
  });

  test('handles error status correctly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeStepEvent(0, 'step.finished', { status: 'error', totalDurationMs: 0 })],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.status).toBe('error');
  });

  test('handles a mix of event types for same step', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(0, 'step.queued', {}, '2026-06-24T10:00:00Z'),
        makeStepEvent(0, 'step.started', {}, '2026-06-24T10:00:01Z'),
        makeStepEvent(0, 'assertion.ran', { passed: true }, '2026-06-24T10:00:02Z'),
        makeStepEvent(
          0,
          'step.finished',
          { status: 'passed', totalDurationMs: 150 },
          '2026-06-24T10:00:03Z',
        ),
      ],
    });

    const result = await getRunReport('run-001');

    expect(result!.steps[0]!.events).toHaveLength(4);
    expect(result!.steps[0]!.status).toBe('passed');
    expect(result!.steps[0]!.durationMs).toBe(150);
  });

  test('handles run with alternate status values', async () => {
    for (const status of ['queued', 'running', 'passed', 'failed', 'cancelled']) {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({ rows: [makeRunRow({ status })] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getRunReport(`run-${status}`);
      expect(result!.run.status).toBe(status);
    }
  });
});

describe('evidence interpretation regressions', () => {
  afterEach(() => mockQuery.mockReset());
  test('keeps missing plan steps, skips run events, uses immutable step names, never exposes raw request secrets', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRunRow({
          plan_json: {
            steps: [
              {
                stepId: 'check',
                method: 'GET',
                urlTemplate: 'https://secret.invalid/?token=secret',
              },
              { stepId: 'next', method: 'GET' },
            ],
          },
          workflow_definition: {
            steps: [
              { id: 'check', name: '检查订单状态' },
              { id: 'next', name: '检查付款' },
            ],
          },
        }),
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(-1, 'run.started'),
        makeStepEvent(0, 'request.prepared', {
          method: 'GET',
          url: 'https://secret.invalid/?token=[REDACTED]',
        }),
        makeStepEvent(0, 'step.finished', { status: 'failed' }),
      ],
    });
    const report = await getRunReport('run-001');
    expect(report!.steps.map((step) => [step.name, step.status])).toEqual([
      ['检查订单状态', 'failed'],
      ['检查付款', 'not_run'],
    ]);
    expect(report!.runEvents).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('token=secret');
  });
  test('uses Runner sequence for retries and exposes assertion evidence and skipped status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRunRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEvent(0, 'step.finished', { sequence: 8, status: 'passed' }),
        makeStepEvent(0, 'step.finished', { sequence: 4, status: 'failed' }),
        makeStepEvent(0, 'assertion.evaluated', {
          sequence: 7,
          assertionId: 'a',
          expected: 'paid',
          actual: 'paid',
          passed: true,
          attempt: 2,
        }),
        makeStepEvent(1, 'step.finished', { status: 'skipped' }),
      ],
    });
    const report = await getRunReport('run-001');
    expect(report!.steps[0]!.status).toBe('passed');
    expect(report!.steps[0]!.assertions[0]).toMatchObject({
      expected: 'paid',
      actual: 'paid',
      attempt: 2,
    });
    expect(report!.steps[1]!.status).toBe('skipped');
  });
});
