/**
 * Test Suite service unit tests.
 *
 * Tests test suite CRUD and quality gate evaluation logic (with mocked DB).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

// ─── Mock pool ─────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../db/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

vi.mock('../../../shared/id.js', () => ({
  testSuiteId: () => `ts-${Math.random().toString(36).slice(2, 10)}`,
  testSuiteVersionId: () => `tsv-${Math.random().toString(36).slice(2, 10)}`,
}));

import {
  createTestSuite,
  createTestSuiteVersion,
  deleteTestSuite,
  EmptyTestSuiteVersionError,
  evaluateQualityGate,
  getTestSuite,
  getTestSuiteVersion,
  listTestSuites,
  listTestSuiteVersions,
  RunNotFoundError,
  TestSuiteGateConfigError,
  TestSuiteInUseError,
  TestSuiteNotFoundError,
  TestSuiteVersionNotFoundError,
} from '../test-suite.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makeSuiteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ts-001',
    workspace_id: 'ws-001',
    name: 'CI Gate',
    description: 'Blocking CI quality gate',
    created_at: '2026-06-24T10:00:00Z',
    updated_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeSuiteVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tsv-001',
    test_suite_id: 'ts-001',
    version: 1,
    members_json: [
      { type: 'test', id: 'tc-001' },
      { type: 'workflow', id: 'wf-001' },
    ],
    quality_gate_json: {
      requiredWorkflows: ['wf-001'],
      noNewFailures: true,
      maxFlakyRetries: 3,
      minEndpointCoverage: 80,
      requiredTags: ['critical'],
      blockOnInfraError: false,
    },
    created_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeStepEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-001',
    run_id: 'run-001',
    step_index: 0,
    event_type: 'step.finished',
    payload_json: { status: 'passed', retries: 0 },
    created_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests: CRUD ───────────────────────────────────────────────────

describe('createTestSuite', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates a test suite', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const suite = await createTestSuite('ws-001', 'CI Gate', 'Quality gate for CI');
    expect(suite.name).toBe('CI Gate');
    expect(suite.workspaceId).toBe('ws-001');
  });
});

describe('getTestSuite', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns a test suite by ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] });

    const suite = await getTestSuite('ts-001');
    expect(suite).not.toBeNull();
    expect(suite!.name).toBe('CI Gate');
  });

  test('returns null for non-existent test suite', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const suite = await getTestSuite('non-existent');
    expect(suite).toBeNull();
  });
});

describe('listTestSuites', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns test suites for a workspace', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteRow({ id: 'ts-1' }), makeSuiteRow({ id: 'ts-2' })],
    });

    const suites = await listTestSuites('ws-001');
    expect(suites).toHaveLength(2);
  });
});

describe('deleteTestSuite', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes test suite and its versions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ts-001' }], rowCount: 1 });

    await expect(deleteTestSuite('ts-001')).resolves.not.toThrow();
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0]?.[0]).toContain('WITH deletable');
  });

  test('does not partially delete a suite referenced by a schedule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(deleteTestSuite('ts-001')).rejects.toThrow(TestSuiteInUseError);
  });
});

// ─── Tests: Version CRUD ──────────────────────────────────────────

describe('createTestSuiteVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates a version with auto-increment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] }); // suite exists
    mockQuery.mockResolvedValueOnce({ rows: [{ test_count: 1, workflow_count: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ version: 1 }] }); // latest version
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT version
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE updated_at

    const version = await createTestSuiteVersion(
      'ts-001',
      [
        { type: 'test', id: 'tc-001' },
        { type: 'workflow', id: 'wf-001' },
      ],
      { requiredWorkflows: ['wf-001'] },
    );
    expect(version.version).toBe(2);
  });

  test('throws when suite does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // suite not found

    await expect(createTestSuiteVersion('non-existent', [], {})).rejects.toThrow(
      TestSuiteNotFoundError,
    );
  });

  test('rejects an empty immutable version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] });

    await expect(createTestSuiteVersion('ts-001', [], {})).rejects.toThrow(
      EmptyTestSuiteVersionError,
    );
  });

  test('deduplicates identical members before persistence', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [{ test_count: 1, workflow_count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const version = await createTestSuiteVersion(
      'ts-001',
      [
        { type: 'test', id: 'tc-001' },
        { type: 'test', id: 'tc-001' },
      ],
      {},
    );

    expect(version.members).toEqual([{ type: 'test', id: 'tc-001' }]);
    expect(mockQuery.mock.calls[3]?.[1]?.[3]).toBe('[{"type":"test","id":"tc-001"}]');
  });

  test('rejects a required workflow that is not an execution member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] });

    await expect(
      createTestSuiteVersion('ts-001', [{ type: 'test', id: 'tc-001' }], {
        requiredWorkflows: ['wf-001'],
      }),
    ).rejects.toThrow(TestSuiteGateConfigError);
  });

  test('rejects members without a published executable version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [{ test_count: 0, workflow_count: 0 }] });

    await expect(
      createTestSuiteVersion('ts-001', [{ type: 'test', id: 'tc-unpublished' }], {}),
    ).rejects.toThrow(/published version/);
  });
});

describe('getTestSuiteVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns a version by ID', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow()],
    });

    const version = await getTestSuiteVersion('tsv-001');
    expect(version).not.toBeNull();
    expect(version!.version).toBe(1);
  });

  test('returns null for non-existent version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const version = await getTestSuiteVersion('non-existent');
    expect(version).toBeNull();
  });
});

describe('listTestSuiteVersions', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns versions in descending order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ version: 3 }), makeSuiteVersionRow({ version: 2 })],
    });

    const versions = await listTestSuiteVersions('ts-001');
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe(3);
  });
});

// ─── Tests: Quality Gate Evaluation ────────────────────────────────

describe('evaluateQualityGate', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('throws when version not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getTestSuiteVersion → empty

    await expect(evaluateQualityGate('run-001', 'non-existent-version')).rejects.toThrow(
      TestSuiteVersionNotFoundError,
    );
  });

  test('throws when run not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteVersionRow()] }); // version exists
    mockQuery.mockResolvedValueOnce({ rows: [] }); // run not found

    await expect(evaluateQualityGate('run-001', 'tsv-001')).rejects.toThrow(RunNotFoundError);
  });

  test('returns CANCELLED when run was cancelled', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteVersionRow()] }); // version
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'cancelled', plan_json: {} }],
    }); // run
    mockQuery.mockResolvedValueOnce({ rows: [] }); // step events (empty)

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('CANCELLED');
    expect(result.reason).toContain('cancelled');
  });

  test('returns INCONCLUSIVE when run is still running', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSuiteVersionRow()] }); // version
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'running', plan_json: {} }],
    }); // run
    mockQuery.mockResolvedValueOnce({ rows: [] }); // step events

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('INCONCLUSIVE');
  });

  test('returns FAILED when block-severity assertion fails with noNewFailures', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ quality_gate_json: { noNewFailures: true } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: {} }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({ event_type: 'run.finished', payload_json: { terminalState: 'passed' } }),
        makeStepEventRow({
          event_type: 'assertion.evaluated',
          payload_json: { passed: false, severity: 'block', assertionId: 'a1' },
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'failed', retries: 0 },
          step_index: 0,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('FAILED');
  });

  test('returns FAILED when retries exceed maxFlakyRetries', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ quality_gate_json: { maxFlakyRetries: 3 } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: {} }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({ event_type: 'run.finished', payload_json: { terminalState: 'passed' } }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed', retries: 5 },
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 0,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('FAILED');
    expect(result.reason).toContain('retries');
  });

  test('returns FAILED when coverage is below minEndpointCoverage', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ quality_gate_json: { minEndpointCoverage: 80 } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: {} }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({ event_type: 'run.finished', payload_json: { terminalState: 'passed' } }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 1,
        }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 2,
        }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 3,
        }),
        makeStepEventRow({
          event_type: 'step.started',
          payload_json: {},
          step_index: 4,
        }),
        // Only 2 steps passed = 40% coverage
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed' },
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed' },
          step_index: 1,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'failed' },
          step_index: 2,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'failed' },
          step_index: 3,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'failed' },
          step_index: 4,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('FAILED');
    expect(result.reason).toContain('coverage');
  });

  test('returns FAILED when required tags not in run plan', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ quality_gate_json: { requiredTags: ['critical', 'smoke'] } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: { tags: ['unit'] } }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({ event_type: 'run.finished', payload_json: { terminalState: 'passed' } }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed' },
          step_index: 0,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('FAILED');
    expect(result.details).toBeDefined();
  });

  test('returns FAILED when terminal state is not passed for required workflows', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeSuiteVersionRow({
          quality_gate_json: { requiredWorkflows: ['wf-critical'] },
        }),
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: {} }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({
          event_type: 'run.finished',
          payload_json: { terminalState: 'failed' },
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed' },
          step_index: 0,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('FAILED');
  });

  test('returns PASSED when all criteria met', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeSuiteVersionRow({
          quality_gate_json: {
            requiredWorkflows: ['wf-001'],
            noNewFailures: true,
            maxFlakyRetries: 3,
          },
        }),
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: { tags: [] } }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({
          event_type: 'run.finished',
          payload_json: { terminalState: 'passed' },
        }),
        makeStepEventRow({
          event_type: 'assertion.evaluated',
          payload_json: { passed: true, severity: 'block', assertionId: 'a1' },
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed', retries: 0 },
          step_index: 0,
        }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'passed', retries: 0 },
          step_index: 1,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('PASSED');
    expect(result.details).toBeDefined();
  });

  test('returns INCONCLUSIVE when blockOnInfraError with infrastructure error', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSuiteVersionRow({ quality_gate_json: { blockOnInfraError: true } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'run-001', status: 'passed', plan_json: {} }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeStepEventRow({ event_type: 'run.finished', payload_json: {} }),
        makeStepEventRow({
          event_type: 'step.finished',
          payload_json: { status: 'error', error: { type: 'infrastructure', message: 'timeout' } },
          step_index: 0,
        }),
      ],
    });

    const result = await evaluateQualityGate('run-001', 'tsv-001');
    expect(result.result).toBe('INCONCLUSIVE');
  });
});
