/**
 * Event service unit tests.
 *
 * Tests content hashing, evidence manifest building, and integrity verification.
 * Uses a mocked pg pool to simulate database interactions.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ─── Mock the database pool ────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../../db/db', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn(),
  },
}));

// Mock id generator to return predictable IDs
vi.mock('../../../shared/id', () => {
  let counter = 0;
  return {
    eventId: () => `evt-${++counter}`,
    runId: () => `run-${++counter}`,
  };
});

import type { ObjectStore } from '../../../shared/object-storage.js';
import type { IncomingEvent } from '../event.service';
import {
  buildEvidenceManifest,
  getPersistedEvidenceManifest,
  insertEvents,
  persistEvidenceManifest,
  verifyEvidenceIntegrity,
} from '../event.service';

// ─── Helpers ────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    id: 'evt-test-1',
    runId: 'run-test',
    stepIndex: 0,
    eventType: 'step:start',
    payload: { timestamp: '2026-01-01T00:00:00Z' },
    ...overrides,
  };
}

// ─── insertEvents ──────────────────────────────────────────────────

describe('insertEvents', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('accepts new events', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const result = await insertEvents('run-1', [makeEvent()]);

    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.contentHashes).toHaveLength(1);
  });

  test('detects duplicate events (ON CONFLICT DO NOTHING)', async () => {
    // rowCount=0 means the INSERT was skipped (conflict)
    mockQuery.mockResolvedValue({ rowCount: 0 });

    const result = await insertEvents('run-1', [makeEvent()]);

    expect(result.accepted).toBe(0);
    expect(result.duplicates).toBe(1);
  });

  test('handles mix of new and duplicate events', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 }) // first event: accepted
      .mockResolvedValueOnce({ rowCount: 0 }) // second event: duplicate
      .mockResolvedValueOnce({ rowCount: 1 }); // third event: accepted

    const result = await insertEvents('run-1', [
      makeEvent({ id: 'evt-a' }),
      makeEvent({ id: 'evt-b' }),
      makeEvent({ id: 'evt-c' }),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.contentHashes).toHaveLength(2);
  });

  test('generates an ID when none provided', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    // First call: id counter starts at 1 → 'evt-1'
    const result = await insertEvents('run-1', [
      { runId: 'run-1', stepIndex: 0, eventType: 'step:start', payload: {} },
    ]);

    expect(result.accepted).toBe(1);
  });

  test('content hash is deterministic', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const payload = { status: 200, body: { id: 42 } };
    const result1 = await insertEvents('run-1', [makeEvent({ id: 'evt-same', payload })]);
    const result2 = await insertEvents('run-1', [makeEvent({ id: 'evt-same', payload })]);

    // Same payload → same hash
    expect(result1.contentHashes[0]).toBe(result2.contentHashes[0]);
  });

  test('content hash changes with different payloads', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const result1 = await insertEvents('run-1', [makeEvent({ id: 'evt-1', payload: { a: 1 } })]);
    const result2 = await insertEvents('run-1', [makeEvent({ id: 'evt-2', payload: { a: 2 } })]);

    expect(result1.contentHashes[0]).not.toBe(result2.contentHashes[0]);
  });

  test('content hash is SHA-256 hex string of length 64', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const result = await insertEvents('run-1', [makeEvent()]);

    expect(result.contentHashes[0]).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(result.contentHashes[0]!)).toBe(true);
  });

  test('surfaces database errors instead of reporting false duplicate success', async () => {
    mockQuery.mockRejectedValue(new Error('Connection lost'));

    await expect(insertEvents('run-1', [makeEvent()])).rejects.toThrow(/Connection lost/);
  });

  test('handles multiple events in one call', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const events = Array.from({ length: 9 }, (_, i) => makeEvent({ id: `evt-${i}` }));
    const result = await insertEvents('run-1', events);

    expect(result.accepted).toBe(9);
    expect(result.duplicates).toBe(0);
    expect(result.contentHashes).toHaveLength(9);
  });

  test('preserves stepIndex in the INSERT query', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await insertEvents('run-1', [makeEvent({ stepIndex: 3 })]);

    // query is called with (sql, paramsArray); params[2] is stepIndex
    const callArgs = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(callArgs[1]).toContain('run-1');
    expect(callArgs[1][2]).toBe(3);
  });

  test('externalizes payloads above the inline limit before inserting their reference', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });
    const store: ObjectStore = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      exists: vi.fn(),
    };
    await insertEvents(
      'run-large',
      [makeEvent({ id: 'evt-large', payload: { body: 'x'.repeat(100) } })],
      store,
      10,
    );

    expect(store.put).toHaveBeenCalledWith(
      expect.stringMatching(/^runs\/run-large\/events\/evt-large\/[a-f0-9]{64}\.json$/),
      JSON.stringify({ body: 'x'.repeat(100) }),
      'application/json',
    );
    const params = mockQuery.mock.calls[0]?.[1] as unknown[];
    expect(params[4]).toContain('"externalized":true');
    expect(params[7]).toMatch(/^runs\/run-large\/events\//);
  });
});

// ─── buildEvidenceManifest ─────────────────────────────────────────

describe('buildEvidenceManifest', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('builds manifest for a run with events', async () => {
    const rows = [
      {
        id: 'evt-001',
        step_index: 0,
        event_type: 'step:start',
        payload_json: JSON.stringify({}),
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'evt-002',
        step_index: 0,
        event_type: 'step:end',
        payload_json: JSON.stringify({ status: 200 }),
        created_at: '2026-01-01T00:00:01Z',
      },
    ];
    mockQuery.mockResolvedValue({ rows });

    const manifest = await buildEvidenceManifest('run-1');

    expect(manifest.runId).toBe('run-1');
    expect(manifest.eventCount).toBe(2);
    expect(manifest.totalSizeBytes).toBeGreaterThan(0);
    expect(manifest.manifestHash).toHaveLength(64);
    expect(manifest.events).toHaveLength(2);

    // Each event entry has the required fields
    for (const evt of manifest.events) {
      expect(evt.id).toBeTruthy();
      expect(typeof evt.stepIndex).toBe('number');
      expect(evt.contentHash).toHaveLength(64);
      expect(evt.sizeBytes).toBeGreaterThan(0);
    }
  });

  test('handles empty run (no events)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const manifest = await buildEvidenceManifest('run-empty');

    expect(manifest.runId).toBe('run-empty');
    expect(manifest.eventCount).toBe(0);
    expect(manifest.totalSizeBytes).toBe(0);
    expect(manifest.events).toHaveLength(0);
  });

  test('manifest hash is deterministic for same data', async () => {
    const rows = [
      {
        id: 'evt-x',
        step_index: 0,
        event_type: 'step:end',
        payload_json: '{"status":200}',
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    mockQuery.mockResolvedValue({ rows });

    const m1 = await buildEvidenceManifest('run-1');
    const m2 = await buildEvidenceManifest('run-1');

    expect(m1.manifestHash).toBe(m2.manifestHash);
    expect(m1.totalSizeBytes).toBe(m2.totalSizeBytes);
  });

  test('handles payload_json as object (not string)', async () => {
    const rows = [
      {
        id: 'evt-obj',
        step_index: 0,
        event_type: 'step:start',
        payload_json: { nested: true }, // JSONB comes as object
        created_at: '2026-01-01T00:00:00Z',
      },
    ];
    mockQuery.mockResolvedValue({ rows });

    const manifest = await buildEvidenceManifest('run-1');

    // Should not throw
    expect(manifest.eventCount).toBe(1);
    expect(manifest.events[0]!.contentHash).toHaveLength(64);
  });
});

describe('persistEvidenceManifest', () => {
  beforeEach(() => mockQuery.mockReset());

  test('stores immutable manifest before recording its lookup metadata', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            step_index: 0,
            event_type: 'step:end',
            payload_json: { status: 200 },
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
    const store: ObjectStore = {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      exists: vi.fn(),
    };

    const manifest = await persistEvidenceManifest('run-1', store);

    expect(manifest.objectKey).toBe(`runs/run-1/manifests/${manifest.manifestHash}.json`);
    expect(store.put).toHaveBeenCalledWith(
      manifest.objectKey,
      expect.stringContaining('"runId":"run-1"'),
      'application/json',
    );
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('does not record metadata if object storage fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const store: ObjectStore = {
      put: vi.fn().mockRejectedValue(new Error('S3 unavailable')),
      get: vi.fn(),
      exists: vi.fn(),
    };

    await expect(persistEvidenceManifest('run-1', store)).rejects.toThrow(/S3 unavailable/);
    expect(mockQuery).toHaveBeenCalledOnce();
  });
});

describe('getPersistedEvidenceManifest', () => {
  beforeEach(() => mockQuery.mockReset());

  test('retrieves and verifies the immutable object against database metadata', async () => {
    const eventHash = 'a'.repeat(64);
    const manifestHash = await crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(eventHash))
      .then((bytes) => Buffer.from(bytes).toString('hex'));
    const manifest = {
      runId: 'run-1',
      eventCount: 1,
      totalSizeBytes: 2,
      manifestHash,
      events: [
        {
          id: 'evt-1',
          stepIndex: 0,
          eventType: 'step:end',
          contentHash: eventHash,
          sizeBytes: 2,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    mockQuery.mockResolvedValue({
      rows: [{ manifest_hash: manifestHash, object_key: 'manifest.json' }],
    });
    const store: ObjectStore = {
      put: vi.fn(),
      get: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(manifest)),
        contentLength: 1,
      }),
      exists: vi.fn(),
    };

    await expect(getPersistedEvidenceManifest('run-1', store)).resolves.toMatchObject({
      manifestHash,
      objectKey: 'manifest.json',
    });
  });

  test('rejects tampered stored manifests', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ manifest_hash: 'a'.repeat(64), object_key: 'manifest.json' }],
    });
    const store: ObjectStore = {
      put: vi.fn(),
      get: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode(
          JSON.stringify({ runId: 'run-1', manifestHash: 'a'.repeat(64), events: [] }),
        ),
        contentLength: 1,
      }),
      exists: vi.fn(),
    };

    await expect(getPersistedEvidenceManifest('run-1', store)).rejects.toThrow(/integrity/);
  });
});

// ─── verifyEvidenceIntegrity ───────────────────────────────────────

describe('verifyEvidenceIntegrity', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('verification passes for unmodified evidence', async () => {
    const payload = JSON.stringify({ status: 200 });
    // First call: buildEvidenceManifest queries events
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'evt-a',
          step_index: 0,
          event_type: 'step:end',
          payload_json: payload,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    // Second call: verifyEvidenceIntegrity re-queries events
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'evt-a', payload_json: payload }],
    });

    const result = await verifyEvidenceIntegrity('run-1');

    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(1);
    expect(result.storedHash).toBe(result.computedHash);
  });

  test('verification fails for modified evidence', async () => {
    // Manifest built from original payload
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'evt-a',
          step_index: 0,
          event_type: 'step:end',
          payload_json: '{"status":200}',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });
    // Re-query returns different payload (evidence tampered)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'evt-a', payload_json: '{"status":500}' }],
    });

    const result = await verifyEvidenceIntegrity('run-1');

    expect(result.valid).toBe(false);
    expect(result.storedHash).not.toBe(result.computedHash);
  });

  test('verification passes for empty run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await verifyEvidenceIntegrity('run-empty');

    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(0);
  });
});
