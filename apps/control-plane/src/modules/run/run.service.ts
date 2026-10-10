import type { ExecutionPlan, FrozenStep } from '@sketch-test/runner-protocol';
import { pool } from '../../db/db.js';
import { executionPlanContentHash } from '../../shared/execution-plan-hash.js';
import { runId } from '../../shared/id.js';

interface CustomStep {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  assertions?: Array<{
    description?: string;
    target: string;
    path?: string;
    operator: string;
    expected?: unknown;
    severity: string;
  }>;
  extractions?: Array<{
    name: string;
    source: string;
    expression: string;
    sensitive: boolean;
  }>;
  timeoutMs: number;
}

/** Compile user-defined steps into a Run plan without performing I/O. */
export function createRunFromSteps(rawSteps: CustomStep[]) {
  const id = runId();
  const planId = id;
  const now = new Date().toISOString();

  const steps: FrozenStep[] = rawSteps.map((s, i) => ({
    stepId: `${planId}-step-${i}`,
    sequence: i,
    method: s.method as FrozenStep['method'],
    urlTemplate: s.url,
    headers: s.headers,
    body: s.body,
    maxRetries: 0,
    retryBaseDelayMs: 1000,
    retryBackoffMultiplier: 2,
    retryOnNetworkError: false,
    onFailure: 'stop' as const,
    assertions: (s.assertions ?? []).map((a, ai) => ({
      id: `${planId}-assert-${i}-${ai}`,
      description: a.description,
      target: a.target as FrozenStep['assertions'][0]['target'],
      path: a.path,
      operator: a.operator as FrozenStep['assertions'][0]['operator'],
      expected: a.expected,
      severity: (a.severity ?? 'block') as FrozenStep['assertions'][0]['severity'],
    })),
    extractions: (s.extractions ?? []).map((e) => ({
      name: e.name,
      source: e.source as 'body' | 'header' | 'cookie' | 'status',
      expression: e.expression,
      scope: 'workflow' as const,
      sensitive: e.sensitive,
    })),
    sideEffect: 'read-only' as const,
    enabled: true,
    timeoutMs: s.timeoutMs ?? 30_000,
  }));

  const plan: ExecutionPlan = {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId,
    planHash: executionPlanContentHash(steps),
    adHocRunId: id,
    compiledAt: now,
    steps,
  };

  return { runId: id, plan };
}

/** Compile and persist an ad-hoc Run in the authenticated workspace. */
export async function createPersistedRunFromSteps(workspaceId: string, rawSteps: CustomStep[]) {
  const result = createRunFromSteps(rawSteps);
  await pool.query(
    `INSERT INTO runs (id, workspace_id, api_version_id, status, plan_json)
     VALUES ($1, $2, NULL, 'pending', $3)`,
    [result.runId, workspaceId, JSON.stringify(result.plan)],
  );
  return result;
}

/** Get a run by ID. */
export async function getRun(id: string) {
  const result = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    apiVersionId: row.api_version_id,
    workflowVersionId: row.workflow_version_id,
    testCaseVersionId: row.test_case_version_id,
    status: row.status,
    plan: row.plan_json,
    runnerId: row.runner_id,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** List all runs, newest first. */
export async function listRuns(workspaceId: string, limit = 50) {
  const result = await pool.query(
    `SELECT id, workspace_id, api_version_id, workflow_version_id, test_case_version_id,
            status, runner_id, claimed_at, created_at, finished_at
     FROM runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    apiVersionId: row.api_version_id,
    workflowVersionId: row.workflow_version_id,
    testCaseVersionId: row.test_case_version_id,
    status: row.status,
    runnerId: row.runner_id,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

/** Get an API version by ID. */
export async function getApiVersion(id: string) {
  const result = await pool.query(`SELECT * FROM api_versions WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Create a Run from a published workflow version.
 * Loads the compiled ExecutionPlan from workflow_versions and creates a run.
 */
export async function createRunFromWorkflow(workflowVersionId: string, workspaceId: string) {
  // Load the compiled plan from the workflow version
  const versionResult = await pool.query(
    `SELECT v.id, v.workflow_id, v.version, v.compiled_plan
     FROM workflow_versions v
     JOIN workflows w ON w.id = v.workflow_id
     WHERE v.id = $1 AND w.workspace_id = $2 AND v.compiled_plan IS NOT NULL`,
    [workflowVersionId, workspaceId],
  );

  const [row] = versionResult.rows;
  if (!row) {
    throw new Error(`Workflow version ${workflowVersionId} not found or has no compiled plan`);
  }

  const plan = row.compiled_plan as ExecutionPlan;

  // Ensure the plan has the correct workflow version ID
  plan.workflowVersionId = workflowVersionId;

  const id = runId();

  await pool.query(
    `INSERT INTO runs (id, workspace_id, workflow_version_id, status, plan_json)
     VALUES ($1, $2, $3, 'pending', $4)`,
    [id, workspaceId, workflowVersionId, JSON.stringify(plan)],
  );

  return { runId: id, plan, workflowVersionId };
}
