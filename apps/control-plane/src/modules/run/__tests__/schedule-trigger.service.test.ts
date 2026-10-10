/**
 * Scheduled execution must enqueue real, immutable workflow plans or fail
 * explicitly. It must never create an empty or zero-hash plan.
 */
import type { ExecutionPlan } from '@sketch-test/runner-protocol';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { executionPlanContentHash } from '../../../shared/execution-plan-hash.js';

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
let nextRun = 0;

vi.mock('../../../db/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn(async () => ({ query: mockClientQuery, release: mockRelease })),
  },
}));

vi.mock('../../../shared/id.js', () => ({
  generateId: () => 'sched-generated',
  runId: () => `run-${++nextRun}`,
}));

import { ScheduleTriggerError, triggerSchedule } from '../schedule.service.js';

function scheduleRow() {
  return {
    id: 'sched-1',
    workspace_id: 'ws-1',
    test_suite_id: 'suite-1',
    cron_expression: '0 9 * * *',
    environment_id: null,
    enabled: true,
    created_at: '2026-07-11T00:00:00.000Z',
  };
}

function validPlan(): ExecutionPlan {
  const steps = [
    {
      stepId: 'health',
      sequence: 0,
      method: 'GET' as const,
      urlTemplate: 'https://example.test/health',
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop' as const,
      assertions: [
        {
          id: 'status-ok',
          target: 'status' as const,
          operator: 'equals' as const,
          expected: 200,
          severity: 'block' as const,
        },
      ],
      extractions: [],
      sideEffect: 'read-only' as const,
      enabled: true,
      timeoutMs: 30_000,
    },
  ];
  return {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId: 'plan-1',
    planHash: executionPlanContentHash(steps),
    workflowVersionId: 'wfv-1',
    compiledAt: '2026-07-11T00:00:00.000Z',
    steps,
  };
}

afterEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  nextRun = 0;
});

describe('triggerSchedule', () => {
  test('transactionally enqueues the latest valid workflow plan', async () => {
    const plan = validPlan();
    mockQuery
      .mockResolvedValueOnce({ rows: [scheduleRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: 'tsv-2', members_json: [{ type: 'workflow', id: 'wf-1' }] }],
      })
      .mockResolvedValueOnce({ rows: [{ compiled_plan: plan }] });
    mockClientQuery.mockResolvedValue({ rows: [] });

    await expect(triggerSchedule('sched-1')).resolves.toEqual({
      testSuiteVersionId: 'tsv-2',
      runIds: ['run-1'],
    });

    expect(mockClientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO runs'),
      ['run-1', 'ws-1', 'wfv-1', null, JSON.stringify(plan)],
    );
    expect(mockClientQuery).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  test('rejects an empty suite version without creating a run', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [scheduleRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 'tsv-empty', members_json: [] }] });

    await expect(triggerSchedule('sched-1')).rejects.toThrow(
      new ScheduleTriggerError('Test suite version tsv-empty has no members'),
    );
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  test('compiles a published TestCaseVersion with first-class provenance', async () => {
    const definition = {
      schemaVersion: 'sketch-test.test/v1',
      id: 'test-definition-1',
      name: 'Health check',
      request: {
        method: 'GET',
        url: 'https://example.test/health',
        timeoutMs: 5000,
      },
      assertions: [
        {
          id: 'status-ok',
          target: 'status',
          statusCode: 200,
          operator: 'equals',
          severity: 'block',
        },
      ],
      sideEffect: 'read-only',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [scheduleRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: 'tsv-test', members_json: [{ type: 'test', id: 'tc-1' }] }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'tcv-3', definition }] });
    mockClientQuery.mockResolvedValue({ rows: [] });

    await expect(triggerSchedule('sched-1')).resolves.toEqual({
      testSuiteVersionId: 'tsv-test',
      runIds: ['run-1'],
    });
    const insertParams = mockClientQuery.mock.calls[1]?.[1] as unknown[];
    expect(insertParams.slice(0, 4)).toEqual(['run-1', 'ws-1', null, 'tcv-3']);
    const storedPlan = JSON.parse(insertParams[4] as string);
    expect(storedPlan).toMatchObject({
      testCaseVersionId: 'tcv-3',
      steps: [{ originTestVersionId: 'tcv-3', timeoutMs: 5000 }],
    });
    expect(storedPlan).not.toHaveProperty('workflowVersionId');
  });

  test('rejects a stored plan whose content no longer matches its hash', async () => {
    const plan = { ...validPlan(), planHash: '0'.repeat(64) };
    mockQuery
      .mockResolvedValueOnce({ rows: [scheduleRow()] })
      .mockResolvedValueOnce({
        rows: [{ id: 'tsv-2', members_json: [{ type: 'workflow', id: 'wf-1' }] }],
      })
      .mockResolvedValueOnce({ rows: [{ compiled_plan: plan }] });

    await expect(triggerSchedule('sched-1')).rejects.toThrow(/invalid content hash/);
    expect(mockClientQuery).not.toHaveBeenCalled();
  });
});

test('a cron minute already claimed creates no duplicate Runs', async () => {
  const row = { ...scheduleRow(), cron_expression: '* * * * *' };
  mockQuery
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValueOnce({
      rows: [{ id: 'tsv-1', members_json: [{ type: 'workflow', id: 'wf-1' }] }],
    })
    .mockResolvedValueOnce({ rows: [{ compiled_plan: validPlan() }] });
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) return { rows: [row] };
    if (sql.includes('INSERT INTO schedule_dispatches')) return { rowCount: 0, rows: [] };
    return { rows: [] };
  });
  expect(await triggerSchedule('sched-1', new Date('2026-10-08T10:00:00Z'))).toBeNull();
  expect(mockClientQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO runs'))).toBe(
    false,
  );
  expect(mockClientQuery).toHaveBeenLastCalledWith('ROLLBACK');
});

test('cron claim and all Runs roll back together if insertion fails', async () => {
  const row = { ...scheduleRow(), cron_expression: '* * * * *' };
  mockQuery
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValueOnce({
      rows: [{ id: 'tsv-1', members_json: [{ type: 'workflow', id: 'wf-1' }] }],
    })
    .mockResolvedValueOnce({ rows: [{ compiled_plan: validPlan() }] });
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FOR UPDATE')) return { rows: [row] };
    if (sql.includes('INSERT INTO schedule_dispatches')) return { rowCount: 1, rows: [] };
    if (sql.includes('INSERT INTO runs')) throw new Error('storage unavailable');
    return { rows: [] };
  });
  await expect(triggerSchedule('sched-1', new Date('2026-10-08T10:00:00Z'))).rejects.toThrow(
    'storage unavailable',
  );
  expect(mockClientQuery).toHaveBeenLastCalledWith('ROLLBACK');
  expect(mockClientQuery).not.toHaveBeenCalledWith('COMMIT');
});
