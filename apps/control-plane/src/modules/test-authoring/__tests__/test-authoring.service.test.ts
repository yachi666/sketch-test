/**
 * Test Authoring service unit tests.
 *
 * Tests diff computation (pure logic) and CRUD operations (with mocked DB).
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
  testCaseId: () => `tc-${Math.random().toString(36).slice(2, 10)}`,
  testCaseVersionId: () => `tcv-${Math.random().toString(36).slice(2, 10)}`,
}));

import {
  compareVersions,
  createTestCase,
  deleteTestCase,
  diffDefinitions,
  getLatestPublishedVersion,
  getTestCase,
  getTestCaseVersion,
  listTestCases,
  listTestCaseVersions,
  publishVersion,
  saveDraft,
  TestAuthoringError,
  updateTestCase,
} from '../test-authoring.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makeTestCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tc-001',
    workspace_id: 'ws-001',
    api_version_id: 'av-001',
    name: 'Test Case 1',
    description: 'Description',
    created_at: '2026-06-24T10:00:00Z',
    updated_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tcv-001',
    test_case_id: 'tc-001',
    version: 1,
    definition: { method: 'GET', url: '/api/users' },
    side_effect: 'read-only',
    published_by: null,
    published_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests: diffDefinitions (pure logic) ───────────────────────────

describe('diffDefinitions', () => {
  test('returns empty diff for identical objects', () => {
    const obj = { method: 'GET', url: '/api/users' };
    const result = diffDefinitions(obj, obj);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  test('detects added keys', () => {
    const a = { method: 'GET' };
    const b = { method: 'GET', url: '/api/users' };

    const result = diffDefinitions(a, b);

    expect(result.added).toContain('url');
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  test('detects removed keys', () => {
    const a = { method: 'GET', url: '/api/users' };
    const b = { method: 'GET' };

    const result = diffDefinitions(a, b);

    expect(result.removed).toContain('url');
    expect(result.added).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  test('detects modified values', () => {
    const a = { method: 'GET', timeout: 1000 };
    const b = { method: 'GET', timeout: 2000 };

    const result = diffDefinitions(a, b);

    expect(result.modified).toContain('timeout');
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test('flattens nested objects for diff', () => {
    const a = { user: { name: 'Alice', age: 30 } };
    const b = { user: { name: 'Bob', age: 30 } };

    const result = diffDefinitions(a, b);

    expect(result.modified).toContain('user.name');
    expect(result.modified).not.toContain('user.age');
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test('detects nested key addition', () => {
    const a = { user: { name: 'Alice' } };
    const b = { user: { name: 'Alice', email: 'alice@test.com' } };

    const result = diffDefinitions(a, b);

    expect(result.added).toContain('user.email');
  });

  test('detects nested key removal', () => {
    const a = { user: { name: 'Alice', email: 'alice@test.com' } };
    const b = { user: { name: 'Alice' } };

    const result = diffDefinitions(a, b);

    expect(result.removed).toContain('user.email');
  });

  test('handles arrays as leaf values (not traversed)', () => {
    const a = { items: [1, 2, 3] };
    const b = { items: [1, 2, 4] };

    const result = diffDefinitions(a, b);

    expect(result.modified).toContain('items');
  });

  test('handles undefined-like comparison', () => {
    const a = { name: 'Alice', nickname: 'Al' };
    const b = { name: 'Alice' };

    const result = diffDefinitions(a, b);

    expect(result.removed).toContain('nickname');
  });

  test('handles deeply nested structures (3+ levels)', () => {
    const a = { level1: { level2: { level3: { value: 'old' } } } };
    const b = { level1: { level2: { level3: { value: 'new' } } } };

    const result = diffDefinitions(a, b);

    expect(result.modified).toContain('level1.level2.level3.value');
  });

  test('stable serialization for object keys in different order', () => {
    const a = { z: 3, a: 1, m: 2 };
    const b = { a: 1, m: 2, z: 3 };

    const result = diffDefinitions(a, b);

    expect(result.modified).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test('handles numeric and boolean values', () => {
    const a = { active: true, count: 5, ratio: 1.5 };
    const b = { active: false, count: 5, ratio: 2.5 };

    const result = diffDefinitions(a, b);

    expect(result.modified).toContain('active');
    expect(result.modified).toContain('ratio');
    expect(result.modified).not.toContain('count');
  });
});

// ─── Tests: CRUD with mocked DB ────────────────────────────────────

describe('createTestCase', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates a test case and returns the row', async () => {
    const expectedRow = makeTestCaseRow({ name: 'My Test', description: 'Test desc' });
    mockQuery.mockResolvedValueOnce({ rows: [expectedRow] });

    const tc = await createTestCase('ws-001', 'My Test', 'av-001', 'Test desc');

    expect(tc.name).toBe('My Test');
    expect(tc.workspace_id).toBe('ws-001');
    expect(tc.api_version_id).toBe('av-001');
  });

  test('creates a test case without api version', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeTestCaseRow({ api_version_id: null })],
    });

    const tc = await createTestCase('ws-001', 'Standalone');
    expect(tc.api_version_id).toBeNull();
  });

  test('rejects an API version outside the workspace', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(createTestCase('ws-001', 'Cross tenant', 'av-other')).rejects.toThrow(
      TestAuthoringError,
    );
  });
});

describe('getTestCase', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns test case with latest version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTestCaseRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [makeVersionRow()] });

    const result = await getTestCase('tc-001');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test Case 1');
    expect(result!.latestVersion).not.toBeNull();
    expect(result!.latestVersion!.version).toBe(1);
  });

  test('returns test case with null latestVersion when no versions exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTestCaseRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getTestCase('tc-001');

    expect(result!.latestVersion).toBeNull();
  });

  test('returns null for non-existent test case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getTestCase('non-existent');
    expect(result).toBeNull();
  });
});

describe('listTestCases', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns test cases with batch-loaded latest versions', async () => {
    const tcs = [makeTestCaseRow({ id: 'tc-1' }), makeTestCaseRow({ id: 'tc-2' })];
    mockQuery.mockResolvedValueOnce({ rows: tcs });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { ...makeVersionRow({ test_case_id: 'tc-1', version: 3 }) },
        { ...makeVersionRow({ test_case_id: 'tc-2', version: 1 }) },
      ],
    });

    const result = await listTestCases('ws-001');

    expect(result).toHaveLength(2);
    expect(result[0]!.latestVersion!.version).toBe(3);
    expect(result[1]!.latestVersion!.version).toBe(1);
  });

  test('returns empty list when no test cases exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await listTestCases('ws-empty');
    expect(result).toEqual([]);
  });
});

describe('updateTestCase', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeTestCaseRow({ name: 'Updated Name' })],
    });

    const tc = await updateTestCase('tc-001', 'Updated Name');
    expect(tc!.name).toBe('Updated Name');
  });

  test('returns current state when no fields provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTestCaseRow()] });

    const tc = await updateTestCase('tc-001');
    expect(tc!.name).toBe('Test Case 1');
  });

  test('returns null for non-existent test case', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const tc = await updateTestCase('non-existent', 'New');
    expect(tc).toBeNull();
  });
});

describe('deleteTestCase', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes test case and versions, returns true', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE versions
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }], rowCount: 1 }); // DELETE test case

    const deleted = await deleteTestCase('tc-001');
    expect(deleted).toBe(true);
  });

  test('returns false when test case not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE versions
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const deleted = await deleteTestCase('non-existent');
    expect(deleted).toBe(false);
  });
});

describe('saveDraft', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('saves a new draft version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }] }); // check test case exists
    mockQuery.mockResolvedValueOnce({ rows: [{ max_version: 0 }] }); // get max version
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ version: 1, definition: { method: 'POST' } })],
    }); // INSERT version

    const version = await saveDraft('tc-001', { method: 'POST' });
    expect(version.version).toBe(1);
  });

  test('throws when test case does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(saveDraft('non-existent', {})).rejects.toThrow(TestAuthoringError);
  });

  test('auto-increments version number', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ max_version: 3 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ version: 4 })],
    });

    const version = await saveDraft('tc-001', {});
    expect(version.version).toBe(4);
  });

  test('throws on revision conflict', async () => {
    // saveDraft calls: (1) check test case exists, (2) get max version, (3) insert version
    // With max_version=5, nextVersion=6. expectedRevision=3 → mismatch → throw
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ max_version: 5 }] }); // current max is 5

    await expect(saveDraft('tc-001', {}, 3)).rejects.toThrow(TestAuthoringError);
  });

  test('passes optimistic locking when expected matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ max_version: 3 }] }); // current is 3
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ version: 4 })],
    });

    const version = await saveDraft('tc-001', {}, 3);
    expect(version.version).toBe(4);
  });

  test('extracts sideEffect from definition', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tc-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ max_version: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ version: 1, side_effect: 'irreversible' })],
    });

    const version = await saveDraft('tc-001', { sideEffect: 'irreversible' });
    expect(version.side_effect).toBe('irreversible');
  });
});

describe('publishVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('publishes a version with published_by', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeVersionRow({
          published_by: 'user-001',
          published_at: '2026-06-24T11:00:00Z',
        }),
      ],
    });

    const version = await publishVersion('tcv-001', 'user-001');
    expect(version).not.toBeNull();
    expect(version!.published_by).toBe('user-001');
  });

  test('returns null for non-existent version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const version = await publishVersion('non-existent', 'user-001');
    expect(version).toBeNull();
  });
});

describe('getTestCaseVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns a version by ID', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ id: 'tcv-002', version: 2 })],
    });

    const version = await getTestCaseVersion('tcv-002');
    expect(version).not.toBeNull();
    expect(version!.version).toBe(2);
  });

  test('returns null for non-existent version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const version = await getTestCaseVersion('non-existent');
    expect(version).toBeNull();
  });
});

describe('listTestCaseVersions', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns versions in descending order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeVersionRow({ id: 'tcv-3', version: 3 }),
        makeVersionRow({ id: 'tcv-2', version: 2 }),
        makeVersionRow({ id: 'tcv-1', version: 1 }),
      ],
    });

    const versions = await listTestCaseVersions('tc-001');
    expect(versions).toHaveLength(3);
    expect(versions[0]!.version).toBe(3);
    expect(versions[2]!.version).toBe(1);
  });
});

describe('getLatestPublishedVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns latest published version', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ version: 5, published_by: 'user-001' })],
    });

    const version = await getLatestPublishedVersion('tc-001');
    expect(version).not.toBeNull();
    expect(version!.version).toBe(5);
    expect(version!.published_by).toBe('user-001');
  });

  test('returns null when no published versions exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const version = await getLatestPublishedVersion('tc-001');
    expect(version).toBeNull();
  });
});

describe('compareVersions', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('compares two versions and returns diff', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ id: 'tcv-1', definition: { method: 'GET' } })],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ id: 'tcv-2', definition: { method: 'POST' } })],
    });

    const diff = await compareVersions('tcv-1', 'tcv-2', 'ws-001');
    expect(diff).not.toBeNull();
    expect(diff!.modified).toContain('method');
  });

  test('returns null when one version is missing', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeVersionRow({ id: 'tcv-1' })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const diff = await compareVersions('tcv-1', 'non-existent', 'ws-001');
    expect(diff).toBeNull();
  });

  test('returns null when both versions missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const diff = await compareVersions('bad-1', 'bad-2', 'ws-001');
    expect(diff).toBeNull();
  });
});

describe('TestAuthoringError', () => {
  test('creates error with message and status code', () => {
    const err = new TestAuthoringError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('TestAuthoringError');
  });
});
