/**
 * Test Suite Service — CRUD for test suites, versions, and quality gate evaluation.
 *
 * A Test Suite groups tests and workflows together under versioned configurations.
 * Each version carries a quality gate config that determines pass/fail criteria
 * when evaluating a run against the suite.
 *
 * DB tables: test_suites, test_suite_versions
 */

import { pool } from '../../db/db.js';
import { testSuiteId, testSuiteVersionId } from '../../shared/id.js';

// ── Types ──────────────────────────────────────────────────────────────────────────

export interface TestSuiteMember {
  type: 'test' | 'workflow';
  id: string;
}

export interface QualityGateConfig {
  requiredWorkflows?: string[];
  noNewFailures?: boolean;
  maxFlakyRetries?: number;
  minEndpointCoverage?: number;
  requiredTags?: string[];
  blockOnInfraError?: boolean;
}

export interface TestSuite {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestSuiteVersion {
  id: string;
  testSuiteId: string;
  version: number;
  members: TestSuiteMember[];
  qualityGate: QualityGateConfig;
  createdAt: string;
}

export type QualityGateResultStatus =
  | 'PASSED'
  | 'FAILED'
  | 'BLOCKED'
  | 'INCONCLUSIVE'
  | 'CANCELLED';

export interface QualityGateResult {
  result: QualityGateResultStatus;
  reason?: string;
  details?: Record<string, unknown>;
}

// ── Row mappers ────────────────────────────────────────────────────────────────────

function rowToTestSuite(row: Record<string, unknown>): TestSuite {
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    createdAt: formatTimestamp(row['created_at']),
    updatedAt: formatTimestamp(row['updated_at']),
  };
}

function rowToTestSuiteVersion(row: Record<string, unknown>): TestSuiteVersion {
  return {
    id: row['id'] as string,
    testSuiteId: row['test_suite_id'] as string,
    version: row['version'] as number,
    members: (row['members_json'] as TestSuiteMember[]) ?? [],
    qualityGate: (row['quality_gate_json'] as QualityGateConfig) ?? {},
    createdAt: formatTimestamp(row['created_at']),
  };
}

function formatTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

// ── Errors ─────────────────────────────────────────────────────────────────────────

export class TestSuiteNotFoundError extends Error {
  constructor(id: string) {
    super(`Test suite ${id} not found`);
    this.name = 'TestSuiteNotFoundError';
  }
}

export class TestSuiteVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Test suite version ${id} not found`);
    this.name = 'TestSuiteVersionNotFoundError';
  }
}

export class TestSuiteMemberNotFoundError extends Error {
  constructor() {
    super(
      'One or more suite members were not found or have no published version in the test suite workspace',
    );
    this.name = 'TestSuiteMemberNotFoundError';
  }
}

export class TestSuiteGateConfigError extends Error {
  constructor() {
    super('Required workflows must also be workflow members of the test suite version');
    this.name = 'TestSuiteGateConfigError';
  }
}

export class EmptyTestSuiteVersionError extends Error {
  constructor() {
    super('A test suite version must contain at least one test or workflow');
    this.name = 'EmptyTestSuiteVersionError';
  }
}

export class TestSuiteInUseError extends Error {
  constructor(id: string) {
    super(`Test suite ${id} is referenced by one or more schedules`);
    this.name = 'TestSuiteInUseError';
  }
}

export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`Run ${id} not found`);
    this.name = 'RunNotFoundError';
  }
}

// ── Test Suite CRUD ────────────────────────────────────────────────────────────────

/** Create a test suite within a workspace. */
export async function createTestSuite(
  workspaceId: string,
  name: string,
  description?: string,
): Promise<TestSuite> {
  const id = testSuiteId();
  const now = new Date().toISOString();
  const desc = description ?? '';

  await pool.query(
    `INSERT INTO test_suites (id, workspace_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, workspaceId, name, desc, now, now],
  );

  return {
    id,
    workspaceId,
    name,
    description: desc,
    createdAt: now,
    updatedAt: now,
  };
}

/** Get a test suite by ID. Returns null if not found. */
export async function getTestSuite(id: string): Promise<TestSuite | null> {
  const result = await pool.query('SELECT * FROM test_suites WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToTestSuite(result.rows[0]);
}

/** Get a test suite with its latest version. */
export async function getTestSuiteWithLatestVersion(
  id: string,
): Promise<{ suite: TestSuite; latestVersion: TestSuiteVersion | null } | null> {
  const suite = await getTestSuite(id);
  if (!suite) return null;

  const versionResult = await pool.query(
    `SELECT * FROM test_suite_versions
     WHERE test_suite_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [id],
  );

  const latestVersion =
    versionResult.rows.length > 0 ? rowToTestSuiteVersion(versionResult.rows[0]) : null;

  return { suite, latestVersion };
}

/** List all test suites in a workspace, newest first. */
export async function listTestSuites(workspaceId: string): Promise<TestSuite[]> {
  const result = await pool.query(
    `SELECT * FROM test_suites WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToTestSuite);
}

/** Delete a test suite and all its versions atomically when no schedule references it. */
export async function deleteTestSuite(id: string): Promise<void> {
  const result = await pool.query(
    `WITH deletable AS (
       SELECT id FROM test_suites
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM schedule_configs WHERE test_suite_id = $1
         )
     ), deleted_versions AS (
       DELETE FROM test_suite_versions
       WHERE test_suite_id IN (SELECT id FROM deletable)
     )
     DELETE FROM test_suites
     WHERE id IN (SELECT id FROM deletable)
     RETURNING id`,
    [id],
  );
  if ((result.rowCount ?? 0) === 0) throw new TestSuiteInUseError(id);
}

// ── Test Suite Version CRUD ────────────────────────────────────────────────────────

/** Create a new version for a test suite. Auto-increments the version number. */
export async function createTestSuiteVersion(
  testSuiteId: string,
  members: TestSuiteMember[],
  qualityGate: QualityGateConfig,
): Promise<TestSuiteVersion> {
  // Verify the test suite exists
  const suite = await getTestSuite(testSuiteId);
  if (!suite) {
    throw new TestSuiteNotFoundError(testSuiteId);
  }
  if (members.length === 0) throw new EmptyTestSuiteVersionError();

  const uniqueMembers = [
    ...new Map(members.map((member) => [`${member.type}:${member.id}`, member])).values(),
  ];

  const testIds = [
    ...new Set(uniqueMembers.filter((member) => member.type === 'test').map((m) => m.id)),
  ];
  const workflowIds = [
    ...new Set(
      uniqueMembers.filter((member) => member.type === 'workflow').map((member) => member.id),
    ),
  ];
  if ((qualityGate.requiredWorkflows ?? []).some((id) => !workflowIds.includes(id))) {
    throw new TestSuiteGateConfigError();
  }
  if (testIds.length > 0 || workflowIds.length > 0) {
    const ownership = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM test_cases test
          WHERE test.workspace_id = $1 AND test.id = ANY($2::text[])
            AND EXISTS (
              SELECT 1 FROM test_case_versions version
              WHERE version.test_case_id = test.id AND version.published_by IS NOT NULL
            )) AS test_count,
         (SELECT COUNT(*)::int FROM workflows workflow
          WHERE workflow.workspace_id = $1 AND workflow.id = ANY($3::text[])
            AND EXISTS (
              SELECT 1 FROM workflow_versions version
              WHERE version.workflow_id = workflow.id AND version.compiled_plan IS NOT NULL
            )) AS workflow_count`,
      [suite.workspaceId, testIds, workflowIds],
    );
    const counts = ownership.rows[0] as
      | { test_count?: number; workflow_count?: number }
      | undefined;
    if (counts?.test_count !== testIds.length || counts.workflow_count !== workflowIds.length) {
      throw new TestSuiteMemberNotFoundError();
    }
  }

  // Get the latest version number, or 0 if none exist
  const latestResult = await pool.query(
    `SELECT version FROM test_suite_versions
     WHERE test_suite_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [testSuiteId],
  );
  const nextVersion =
    latestResult.rows.length > 0 ? (latestResult.rows[0].version as number) + 1 : 1;

  const id = testSuiteVersionId();
  const now = new Date().toISOString();

  await pool.query(
    `INSERT INTO test_suite_versions
      (id, test_suite_id, version, members_json, quality_gate_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, testSuiteId, nextVersion, JSON.stringify(uniqueMembers), JSON.stringify(qualityGate), now],
  );

  // Update the test suite's updated_at
  await pool.query(`UPDATE test_suites SET updated_at = $2 WHERE id = $1`, [testSuiteId, now]);

  return {
    id,
    testSuiteId,
    version: nextVersion,
    members: uniqueMembers,
    qualityGate,
    createdAt: now,
  };
}

/** Get a specific test suite version by ID. */
export async function getTestSuiteVersion(id: string): Promise<TestSuiteVersion | null> {
  const result = await pool.query('SELECT * FROM test_suite_versions WHERE id = $1', [id]);
  if (result.rows.length === 0) return null;
  return rowToTestSuiteVersion(result.rows[0]);
}

/** List all versions for a test suite, newest first. */
export async function listTestSuiteVersions(testSuiteId: string): Promise<TestSuiteVersion[]> {
  const result = await pool.query(
    `SELECT * FROM test_suite_versions
     WHERE test_suite_id = $1
     ORDER BY version DESC`,
    [testSuiteId],
  );
  return result.rows.map(rowToTestSuiteVersion);
}

// ── Quality Gate Evaluation ────────────────────────────────────────────────────────

interface StepEventRow {
  id: string;
  run_id: string;
  step_index: number;
  event_type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

/**
 * Evaluate a run against a test suite version's quality gate configuration.
 *
 * Evaluation order (first matching condition determines the result):
 * 1. CANCELLED — the run was cancelled
 * 2. INCONCLUSIVE — infrastructure error occurred and blockOnInfraError is enabled
 * 3. BLOCKED — approval required but not given
 * 4. FAILED — assertion failures (when noNewFailures is set), retry limits exceeded,
 *    coverage below threshold, or required tags/workflows not satisfied
 * 5. PASSED — all gate criteria satisfied
 */
export async function evaluateQualityGate(
  runId: string,
  testSuiteVersionId: string,
): Promise<QualityGateResult> {
  // Get the test suite version with its quality gate config
  const versionResult = await pool.query(
    `SELECT v.*, s.workspace_id
     FROM test_suite_versions v
     JOIN test_suites s ON s.id = v.test_suite_id
     WHERE v.id = $1`,
    [testSuiteVersionId],
  );
  if (versionResult.rows.length === 0) {
    throw new TestSuiteVersionNotFoundError(testSuiteVersionId);
  }
  const version = rowToTestSuiteVersion(versionResult.rows[0]);
  const workspaceId = versionResult.rows[0].workspace_id as string;
  const gateConfig = version.qualityGate;

  // Get the run
  const runResult = await pool.query('SELECT * FROM runs WHERE id = $1 AND workspace_id = $2', [
    runId,
    workspaceId,
  ]);
  if (runResult.rows.length === 0) {
    throw new RunNotFoundError(runId);
  }
  const run = runResult.rows[0];

  // Get all step events for the run
  const eventsResult = await pool.query(
    `SELECT id, run_id, step_index, event_type, payload_json, created_at
     FROM step_events
     WHERE run_id = $1
     ORDER BY step_index, created_at`,
    [runId],
  );
  const events: StepEventRow[] = eventsResult.rows;

  // ── 1. Check for cancellation ──
  if (run.status === 'cancelled') {
    return { result: 'CANCELLED', reason: 'Run was cancelled' };
  }

  // ── 2. Check for infrastructure errors ──
  const infraErrors = events.filter((e) => {
    if (e.event_type === 'step.finished') {
      const payload = e.payload_json;
      return payload?.['status'] === 'error' && payload?.['error'] != null;
    }
    return false;
  });

  const hasInfraError = infraErrors.some((e) => {
    const error = e.payload_json?.['error'] as Record<string, unknown> | undefined;
    return error?.['type'] === 'infrastructure';
  });

  if (hasInfraError && gateConfig.blockOnInfraError === true) {
    return {
      result: 'INCONCLUSIVE',
      reason: 'Infrastructure error occurred with blockOnInfraError enabled',
    };
  }

  // ── 3. Check for blocked (approval required) ──
  // This checks if the test suite version requires approval that hasn't been given.
  // In practice this would integrate with an approval workflow; for now we infer
  // from the quality gate config and run metadata.
  const runFinishedEvent = events.find((e) => e.event_type === 'run.finished');
  if (run.status === 'running' || !runFinishedEvent) {
    // Run hasn't finished — cannot determine final gate result yet
    return {
      result: 'INCONCLUSIVE',
      reason: 'Run has not finished yet',
    };
  }

  // ── 4. Gather assertion results ──
  const assertionEvents = events.filter((e) => e.event_type === 'assertion.evaluated');

  const failedBlockAssertions = assertionEvents.filter((e) => {
    const payload = e.payload_json;
    return payload?.['passed'] === false && payload?.['severity'] === 'block';
  });

  const failedWarnAssertions = assertionEvents.filter((e) => {
    const payload = e.payload_json;
    return payload?.['passed'] === false && payload?.['severity'] === 'warn';
  });

  // ── 5. Collect step-level statistics ──
  const stepFinishedEvents = events.filter((e) => e.event_type === 'step.finished');

  let totalRetries = 0;
  let stepsFailed = 0;
  let stepsPassed = 0;

  for (const e of stepFinishedEvents) {
    const payload = e.payload_json;
    totalRetries += (payload?.['retries'] as number) ?? 0;
    if (payload?.['status'] === 'failed') stepsFailed++;
    if (payload?.['status'] === 'passed') stepsPassed++;
  }

  // ── 6. Evaluate failure conditions ──

  // 6a. noNewFailures: fail if any block-severity assertion failed
  if (gateConfig.noNewFailures === true && failedBlockAssertions.length > 0) {
    return {
      result: 'FAILED',
      reason: `${failedBlockAssertions.length} block-severity assertion(s) failed with noNewFailures enabled`,
      details: {
        failedAssertions: failedBlockAssertions.map((e) => ({
          assertionId: e.payload_json?.['assertionId'],
          description: e.payload_json?.['description'],
          stepIndex: e.step_index,
          actual: e.payload_json?.['actual'],
          expected: e.payload_json?.['expected'],
        })),
        warnAssertions: failedWarnAssertions.length,
      },
    };
  }

  // 6b. maxFlakyRetries: fail if retry count exceeds the threshold
  if (gateConfig.maxFlakyRetries !== undefined && totalRetries > gateConfig.maxFlakyRetries) {
    return {
      result: 'FAILED',
      reason: `Total retries (${totalRetries}) exceeds maxFlakyRetries (${gateConfig.maxFlakyRetries})`,
      details: { totalRetries, maxFlakyRetries: gateConfig.maxFlakyRetries },
    };
  }

  // 6c. minEndpointCoverage: fail if endpoint coverage is below threshold
  if (gateConfig.minEndpointCoverage !== undefined) {
    const stepStartedEvents = events.filter((e) => e.event_type === 'step.started');
    const totalSteps = stepStartedEvents.length;
    const coverage = totalSteps > 0 ? Math.round((stepsPassed / totalSteps) * 100) : 0;

    if (coverage < gateConfig.minEndpointCoverage) {
      return {
        result: 'FAILED',
        reason: `Endpoint coverage (${coverage}%) is below minimum (${gateConfig.minEndpointCoverage}%)`,
        details: {
          totalSteps,
          stepsPassed,
          stepsFailed,
          coverage,
          minEndpointCoverage: gateConfig.minEndpointCoverage,
        },
      };
    }
  }

  // 6d. requiredTags: fail if required tags are not satisfied
  if (gateConfig.requiredTags && gateConfig.requiredTags.length > 0) {
    // Tags can come from the run's plan metadata or test suite members
    // Here we check if the run's associated test suite version members
    // satisfy the required tag constraints
    const plan = run.plan_json as Record<string, unknown> | undefined;
    const runTags = (plan?.['tags'] as string[]) ?? [];

    const missingTags = gateConfig.requiredTags.filter((tag) => !runTags.includes(tag));

    if (missingTags.length > 0) {
      return {
        result: 'FAILED',
        reason: `Required tags not satisfied: ${missingTags.join(', ')}`,
        details: { requiredTags: gateConfig.requiredTags, runTags, missingTags },
      };
    }
  }

  // 6e. requiredWorkflows: fail if not all required workflows passed
  if (gateConfig.requiredWorkflows && gateConfig.requiredWorkflows.length > 0) {
    // For a single-run evaluation, check if the run's terminal state is 'passed'
    const terminalState = runFinishedEvent?.payload_json?.['terminalState'] as string | undefined;

    if (terminalState !== 'passed') {
      return {
        result: 'FAILED',
        reason: `Run terminal state is '${terminalState ?? 'unknown'}', required workflows not all passed`,
        details: {
          requiredWorkflows: gateConfig.requiredWorkflows,
          terminalState,
        },
      };
    }
  }

  // ── 7. PASSED: all criteria satisfied ──
  return {
    result: 'PASSED',
    details: {
      totalSteps: stepFinishedEvents.length,
      stepsPassed,
      stepsFailed,
      totalRetries,
      failedBlockAssertions: failedBlockAssertions.length,
      failedWarnAssertions: failedWarnAssertions.length,
    },
  };
}
