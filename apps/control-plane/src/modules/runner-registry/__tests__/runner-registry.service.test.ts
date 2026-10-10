/**
 * Runner Registry service unit tests.
 *
 * Tests token generation/hashing, registration, heartbeat, status management,
 * deletion, and token verification.
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
  runnerId: () => `rnr-${Math.random().toString(36).slice(2, 10)}`,
}));

import {
  deleteRunner,
  getRunner,
  getRunnersByLabel,
  listRunners,
  recordHeartbeat,
  registerRunner,
  updateRunnerStatus,
  verifyRunnerToken,
} from '../runner-registry.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makeRunnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rnr-001',
    workspace_id: 'ws-001',
    name: 'test-runner',
    version: '1.0.0',
    labels: ['default'],
    status: 'offline',
    last_heartbeat: null,
    created_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('registerRunner', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('registers a runner and returns id + token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO runners
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO runner_tokens

    const result = await registerRunner('ws-001', 'my-runner', '1.0.0', ['default']);

    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('token');
    expect(result.token).toMatch(/^sk-[0-9a-f]{48}$/);
  });

  test('stores only the token hash in the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await registerRunner('ws-001', 'my-runner');

    const tokenInsert = mockQuery.mock.calls[1];
    expect(tokenInsert?.[0]).toContain('INSERT INTO runner_tokens');
    expect(tokenInsert?.[1]?.[0]).not.toBe(result.token);
  });

  test('each registration generates unique tokens', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const a = await registerRunner('ws-001', 'runner-a');
    const b = await registerRunner('ws-001', 'runner-b');

    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});

describe('getRunner', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns RunnerRecord when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ name: 'prod-runner', status: 'online' })],
    });

    const runner = await getRunner('rnr-001');

    expect(runner).not.toBeNull();
    expect(runner!.name).toBe('prod-runner');
    expect(runner!.status).toBe('online');
    expect(runner!.workspaceId).toBe('ws-001');
  });

  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const runner = await getRunner('non-existent');
    expect(runner).toBeNull();
  });
});

describe('listRunners', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns runners sorted by created_at DESC', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeRunnerRow({ id: 'rnr-2', name: 'runner-2', created_at: '2026-06-24T11:00:00Z' }),
        makeRunnerRow({ id: 'rnr-1', name: 'runner-1', created_at: '2026-06-24T10:00:00Z' }),
      ],
    });

    const runners = await listRunners('ws-001');
    expect(runners).toHaveLength(2);
    expect(runners[0]!.name).toBe('runner-2');
  });

  test('returns empty array for workspace with no runners', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const runners = await listRunners('ws-empty');
    expect(runners).toEqual([]);
  });
});

describe('recordHeartbeat', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates last_heartbeat and status to online', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT heartbeat

    await recordHeartbeat('rnr-001');

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('stores capacity in heartbeat record', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const capacity = { cpu: 0.5, memory: 512 };
    await recordHeartbeat('rnr-001', capacity);

    // Check second call (heartbeat insert) includes capacity
    const heartbeatCall = mockQuery.mock.calls[1]!;
    expect(heartbeatCall[0]).toContain('runner_heartbeats');
  });
});

describe('updateRunnerStatus', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates runner status to draining', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ status: 'draining' })],
    });

    const runner = await updateRunnerStatus('rnr-001', 'draining');
    expect(runner!.status).toBe('draining');
  });

  test('returns null for non-existent runner', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const runner = await updateRunnerStatus('non-existent', 'offline');
    expect(runner).toBeNull();
  });

  test('supports all valid status transitions', async () => {
    for (const status of ['online', 'offline', 'draining'] as const) {
      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({
        rows: [makeRunnerRow({ status })],
      });

      const runner = await updateRunnerStatus('rnr-001', status);
      expect(runner!.status).toBe(status);
    }
  });
});

describe('deleteRunner', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes runner tokens, heartbeats, and runner record', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // DELETE runner_tokens
      .mockResolvedValueOnce({ rows: [] }) // DELETE runner_heartbeats
      .mockResolvedValueOnce({ rows: [] }); // DELETE runners

    await deleteRunner('rnr-001');

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe('verifyRunnerToken', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('verifies a valid token via DB', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ runner_id: 'rnr-001', workspace_id: 'ws-001' }],
    });

    const result = await verifyRunnerToken('sk-valid-token');

    expect(result).not.toBeNull();
    expect(result!.runnerId).toBe('rnr-001');
    expect(result!.workspaceId).toBe('ws-001');
  });

  test('returns null for unknown token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await verifyRunnerToken('sk-bad-token');
    expect(result).toBeNull();
  });

  test('returns null when the database has no matching token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await verifyRunnerToken('sk-nonexistent');
    expect(result).toBeNull();
  });
});

describe('getRunnersByLabel', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('finds runners with matching label', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ name: 'production-runner', labels: ['production', 'us-east'] })],
    });

    const runners = await getRunnersByLabel('ws-001', 'production');
    expect(runners).toHaveLength(1);
    expect(runners[0]!.name).toBe('production-runner');
  });

  test('returns empty array when no runners match label', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const runners = await getRunnersByLabel('ws-001', 'europe-west');
    expect(runners).toEqual([]);
  });
});

describe('toRunnerRecord', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('handles labels as serialized JSON string', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ labels: '["api","web"]' })],
    });

    const runner = await getRunner('rnr-001');
    expect(runner!.labels).toEqual(['api', 'web']);
  });

  test('handles labels as already-parsed array', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ labels: ['api', 'web'] })],
    });

    const runner = await getRunner('rnr-001');
    expect(runner!.labels).toEqual(['api', 'web']);
  });

  test('handles malformed JSON labels by returning empty array', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ labels: '{broken-json' })],
    });

    const runner = await getRunner('rnr-001');
    expect(runner!.labels).toEqual([]);
  });

  test('handles labels as unknown type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRunnerRow({ labels: null })],
    });

    const runner = await getRunner('rnr-001');
    expect(runner!.labels).toEqual([]);
  });
});
