import { pool } from '../../db/db.js';
import { testCaseId, testCaseVersionId } from '../../shared/id.js';

// ─── Types ─────────────────────────────────────────────────────────

export interface TestCaseRow {
  id: string;
  workspace_id: string;
  api_version_id: string | null;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface TestCaseVersionRow {
  id: string;
  test_case_id: string;
  version: number;
  definition: unknown;
  side_effect: string;
  published_by: string | null;
  published_at: string;
}

export interface TestCaseWithVersion {
  id: string;
  workspaceId: string;
  apiVersionId: string | null;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: TestCaseVersionRow | null;
}

export interface CompareResult {
  added: string[];
  removed: string[];
  modified: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Flatten a JSON object into dot-notated paths for diff comparison. */
function flattenObject(obj: unknown, prefix = ''): Record<string, unknown> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return { [prefix]: obj };
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/** Serialize a value deterministically for comparison. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

/** Compute a simple JSON diff between two definition objects. */
export function diffDefinitions(a: unknown, b: unknown): CompareResult {
  const flatA = flattenObject(a);
  const flatB = flattenObject(b);
  const keysA = new Set(Object.keys(flatA));
  const keysB = new Set(Object.keys(flatB));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const key of keysA) {
    if (!keysB.has(key)) {
      removed.push(key);
    }
  }
  for (const key of keysB) {
    if (!keysA.has(key)) {
      added.push(key);
    }
  }
  for (const key of keysA) {
    if (keysB.has(key)) {
      if (stableStringify(flatA[key]) !== stableStringify(flatB[key])) {
        modified.push(key);
      }
    }
  }

  return { added, removed, modified };
}

// ─── Test Case CRUD ────────────────────────────────────────────────

/** Create a new test case. */
export async function createTestCase(
  workspaceId: string,
  name: string,
  apiVersionId?: string,
  description?: string,
): Promise<TestCaseRow> {
  const id = testCaseId();
  const result = await pool.query(
    `INSERT INTO test_cases (id, workspace_id, api_version_id, name, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, workspaceId, apiVersionId ?? null, name, description ?? ''],
  );
  return result.rows[0] as TestCaseRow;
}

/** Get a test case by ID, including its latest version. */
export async function getTestCase(id: string): Promise<TestCaseWithVersion | null> {
  const tcResult = await pool.query(`SELECT * FROM test_cases WHERE id = $1`, [id]);
  if (tcResult.rows.length === 0) return null;

  const tc = tcResult.rows[0] as TestCaseRow;

  const versionResult = await pool.query(
    `SELECT * FROM test_case_versions
     WHERE test_case_id = $1
     ORDER BY version DESC LIMIT 1`,
    [id],
  );
  const latestVersion =
    versionResult.rows.length > 0 ? (versionResult.rows[0] as TestCaseVersionRow) : null;

  return {
    id: tc.id,
    workspaceId: tc.workspace_id,
    apiVersionId: tc.api_version_id,
    name: tc.name,
    description: tc.description,
    createdAt: tc.created_at,
    updatedAt: tc.updated_at,
    latestVersion,
  };
}

/** List test cases in a workspace, optionally filtered by API version. */
export async function listTestCases(
  workspaceId: string,
  apiVersionId?: string,
): Promise<TestCaseWithVersion[]> {
  let query = `SELECT * FROM test_cases WHERE workspace_id = $1`;
  const params: (string | null)[] = [workspaceId];

  if (apiVersionId) {
    query += ` AND api_version_id = $2`;
    params.push(apiVersionId);
  }
  query += ` ORDER BY updated_at DESC LIMIT 100`;

  const result = await pool.query(query, params);
  const tcs = result.rows as TestCaseRow[];

  // Batch-load latest versions for all test cases
  if (tcs.length === 0) return [];

  const tcIds = tcs.map((tc) => tc.id);
  const versionsResult = await pool.query(
    `SELECT DISTINCT ON (test_case_id) *
     FROM test_case_versions
     WHERE test_case_id = ANY($1)
     ORDER BY test_case_id, version DESC`,
    [tcIds],
  );
  const versionMap = new Map<string, TestCaseVersionRow>();
  for (const row of versionsResult.rows) {
    versionMap.set(row.test_case_id, row as TestCaseVersionRow);
  }

  return tcs.map((tc) => ({
    id: tc.id,
    workspaceId: tc.workspace_id,
    apiVersionId: tc.api_version_id,
    name: tc.name,
    description: tc.description,
    createdAt: tc.created_at,
    updatedAt: tc.updated_at,
    latestVersion: versionMap.get(tc.id) ?? null,
  }));
}

/** Update a test case's name and/or description. */
export async function updateTestCase(
  id: string,
  name?: string,
  description?: string,
): Promise<TestCaseRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (name !== undefined) {
    sets.push(`name = $${paramIdx++}`);
    params.push(name);
  }
  if (description !== undefined) {
    sets.push(`description = $${paramIdx++}`);
    params.push(description);
  }
  if (sets.length === 0) {
    // Nothing to update — return current state
    const current = await pool.query(`SELECT * FROM test_cases WHERE id = $1`, [id]);
    return current.rows.length > 0 ? (current.rows[0] as TestCaseRow) : null;
  }

  sets.push(`updated_at = now()`);
  params.push(id);

  const result = await pool.query(
    `UPDATE test_cases SET ${sets.join(', ')} WHERE id = $${paramIdx}
     RETURNING *`,
    params,
  );
  return result.rows.length > 0 ? (result.rows[0] as TestCaseRow) : null;
}

/** Delete a test case and all its versions. */
export async function deleteTestCase(id: string): Promise<boolean> {
  // Delete versions first (FK constraint)
  await pool.query(`DELETE FROM test_case_versions WHERE test_case_id = $1`, [id]);
  const result = await pool.query(`DELETE FROM test_cases WHERE id = $1 RETURNING id`, [id]);
  return (result.rowCount ?? 0) > 0;
}

// ─── Draft / Version Management ───────────────────────────────────

/** Save a new draft version of a test case. */
export async function saveDraft(
  testCaseId: string,
  definition: unknown,
  expectedRevision?: number,
): Promise<TestCaseVersionRow> {
  // Check that test case exists
  const tc = await pool.query(`SELECT id FROM test_cases WHERE id = $1`, [testCaseId]);
  if (tc.rows.length === 0) {
    throw new TestAuthoringError(`Test case ${testCaseId} not found`, 404);
  }

  // Compute next version number
  const maxVersionResult = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS max_version
     FROM test_case_versions WHERE test_case_id = $1`,
    [testCaseId],
  );
  const nextVersion = (maxVersionResult.rows[0] as { max_version: number }).max_version + 1;

  // If expectedRevision provided, check optimistic locking
  if (expectedRevision !== undefined && expectedRevision !== nextVersion - 1) {
    throw new TestAuthoringError(
      `Revision conflict: expected ${expectedRevision} but current is ${nextVersion - 1}`,
      409,
    );
  }

  // Extract side_effect from definition if present
  const defObj = definition as Record<string, unknown> | null | undefined;
  const sideEffect = (defObj?.['sideEffect'] as string) ?? 'read-only';

  const id = testCaseVersionId();
  const result = await pool.query(
    `INSERT INTO test_case_versions (id, test_case_id, version, definition, side_effect, published_by)
     VALUES ($1, $2, $3, $4, $5, NULL)
     RETURNING *`,
    [id, testCaseId, nextVersion, JSON.stringify(definition), sideEffect],
  );
  return result.rows[0] as TestCaseVersionRow;
}

/** Publish a draft version (sets published_by and stamps published_at). */
export async function publishVersion(
  versionId: string,
  publishedBy?: string,
): Promise<TestCaseVersionRow | null> {
  const result = await pool.query(
    `UPDATE test_case_versions
     SET published_by = $2, published_at = now()
     WHERE id = $1
     RETURNING *`,
    [versionId, publishedBy ?? null],
  );
  if (result.rows.length === 0) return null;
  return result.rows[0] as TestCaseVersionRow;
}

/** Get a specific test case version by ID. */
export async function getTestCaseVersion(versionId: string): Promise<TestCaseVersionRow | null> {
  const result = await pool.query(`SELECT * FROM test_case_versions WHERE id = $1`, [versionId]);
  return result.rows.length > 0 ? (result.rows[0] as TestCaseVersionRow) : null;
}

/** List all versions for a test case, newest first. */
export async function listTestCaseVersions(testCaseId: string): Promise<TestCaseVersionRow[]> {
  const result = await pool.query(
    `SELECT * FROM test_case_versions
     WHERE test_case_id = $1
     ORDER BY version DESC`,
    [testCaseId],
  );
  return result.rows as TestCaseVersionRow[];
}

/** Get the latest published version for a test case. */
export async function getLatestPublishedVersion(
  testCaseId: string,
): Promise<TestCaseVersionRow | null> {
  const result = await pool.query(
    `SELECT * FROM test_case_versions
     WHERE test_case_id = $1 AND published_by IS NOT NULL
     ORDER BY version DESC LIMIT 1`,
    [testCaseId],
  );
  return result.rows.length > 0 ? (result.rows[0] as TestCaseVersionRow) : null;
}

/** Compare two test case versions by their definitions. */
export async function compareVersions(
  versionIdA: string,
  versionIdB: string,
): Promise<CompareResult | null> {
  const [a, b] = await Promise.all([
    getTestCaseVersion(versionIdA),
    getTestCaseVersion(versionIdB),
  ]);
  if (!a || !b) return null;
  return diffDefinitions(a.definition, b.definition);
}

// ─── Custom Error ──────────────────────────────────────────────────

export class TestAuthoringError extends Error {
  public statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'TestAuthoringError';
    this.statusCode = statusCode;
  }
}
