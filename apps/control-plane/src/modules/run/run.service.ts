import type { ExecutionPlan, FrozenStep } from '@sketch-test/runner-protocol';
import { pool } from '../../db/db.js';
import { runId, eventId } from '../../shared/id.js';

const FIXTURE_BASE = process.env['FIXTURE_BASE_URL'] ?? 'http://localhost:3800';

/**
 * Build a hardcoded 5-step ExecutionPlan for the Fixture Server BP-01 flow.
 *
 * M0: We don't have a Workflow Compiler yet. The 5 steps are:
 *   0. POST /api/auth/login → extract accessToken
 *   1. POST /api/users       → extract userId
 *   2. GET  /api/users/:id   → verify user
 *   3. POST /api/orders      → extract orderId
 *   4. GET  /api/orders/:id  → verify order status
 */
export function buildFixturePlan(apiVersionId: string): ExecutionPlan {
  const planId = runId();
  const now = new Date().toISOString();

  const steps: FrozenStep[] = [
    // Step 0: Login
    {
      stepId: `${planId}-step-0`,
      sequence: 0,
      method: 'POST',
      urlTemplate: `${FIXTURE_BASE}/api/auth/login`,
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'test@sketch.dev', password: 'test123456' },
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop',
      assertions: [
        {
          id: `${planId}-assert-0-0`,
          description: 'Status is 200',
          target: 'status',
          operator: 'equals',
          expected: 200,
          severity: 'block',
        },
        {
          id: `${planId}-assert-0-1`,
          description: 'Response has accessToken',
          target: 'jsonPath',
          path: '$.data.accessToken',
          operator: 'exists',
          severity: 'block',
        },
      ],
      extractions: [
        {
          name: 'accessToken',
          source: 'body',
          expression: '$.data.accessToken',
          scope: 'workflow',
          sensitive: true,
        },
      ],
      sideEffect: 'read-only',
      enabled: true,
      timeoutMs: 10_000,
    },
    // Step 1: Create user
    {
      stepId: `${planId}-step-1`,
      sequence: 1,
      method: 'POST',
      urlTemplate: `${FIXTURE_BASE}/api/users`,
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'Alice', email: `alice_${Date.now()}@test.com`, password: 'pass123' },
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop',
      assertions: [
        {
          id: `${planId}-assert-1-0`,
          description: 'Status is 201',
          target: 'status',
          operator: 'equals',
          expected: 201,
          severity: 'block',
        },
        {
          id: `${planId}-assert-1-1`,
          description: 'Response has userId',
          target: 'jsonPath',
          path: '$.data.userId',
          operator: 'exists',
          severity: 'block',
        },
      ],
      extractions: [
        {
          name: 'userId',
          source: 'body',
          expression: '$.data.userId',
          scope: 'workflow',
          sensitive: false,
        },
      ],
      sideEffect: 'cleanup-required',
      enabled: true,
      timeoutMs: 10_000,
    },
    // Step 2: Get user
    {
      stepId: `${planId}-step-2`,
      sequence: 2,
      method: 'GET',
      urlTemplate: `${FIXTURE_BASE}/api/users/\${userId}`,
      headers: {},
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop',
      assertions: [
        {
          id: `${planId}-assert-2-0`,
          description: 'Status is 200',
          target: 'status',
          operator: 'equals',
          expected: 200,
          severity: 'block',
        },
        {
          id: `${planId}-assert-2-1`,
          description: 'User name matches',
          target: 'jsonPath',
          path: '$.data.name',
          operator: 'equals',
          expected: 'Alice',
          severity: 'block',
        },
      ],
      extractions: [],
      sideEffect: 'read-only',
      enabled: true,
      timeoutMs: 10_000,
    },
    // Step 3: Create order
    {
      stepId: `${planId}-step-3`,
      sequence: 3,
      method: 'POST',
      urlTemplate: `${FIXTURE_BASE}/api/orders`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${accessToken}',
      },
      body: {
        amount: 199,
        items: [{ name: 'Widget', price: 199, quantity: 1 }],
      },
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop',
      assertions: [
        {
          id: `${planId}-assert-3-0`,
          description: 'Status is 201',
          target: 'status',
          operator: 'equals',
          expected: 201,
          severity: 'block',
        },
        {
          id: `${planId}-assert-3-1`,
          description: 'Response has order id',
          target: 'jsonPath',
          path: '$.data.orderId',
          operator: 'exists',
          severity: 'block',
        },
      ],
      extractions: [
        {
          name: 'orderId',
          source: 'body',
          expression: '$.data.orderId',
          scope: 'workflow',
          sensitive: false,
        },
      ],
      sideEffect: 'cleanup-required',
      enabled: true,
      timeoutMs: 10_000,
    },
    // Step 4: Get order
    {
      stepId: `${planId}-step-4`,
      sequence: 4,
      method: 'GET',
      urlTemplate: `${FIXTURE_BASE}/api/orders/\${orderId}`,
      headers: {},
      maxRetries: 0,
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: false,
      onFailure: 'stop',
      assertions: [
        {
          id: `${planId}-assert-4-0`,
          description: 'Status is 200',
          target: 'status',
          operator: 'equals',
          expected: 200,
          severity: 'block',
        },
        {
          id: `${planId}-assert-4-1`,
          description: 'Order status is 待支付',
          target: 'jsonPath',
          path: '$.data.status',
          operator: 'equals',
          expected: '待支付',
          severity: 'block',
        },
      ],
      extractions: [],
      sideEffect: 'read-only',
      enabled: true,
      timeoutMs: 10_000,
    },
  ];

  return {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId,
    planHash: '0'.repeat(64), // placeholder — M0 doesn't validate this
    workflowVersionId: apiVersionId,
    compiledAt: now,
    steps,
  };
}

/** Create a new Run with a hardcoded ExecutionPlan. */
export async function createFixtureRun(apiVersionId: string) {
  const id = runId();
  const plan = buildFixturePlan(apiVersionId);

  await pool.query(
    `INSERT INTO runs (id, api_version_id, status, plan_json)
     VALUES ($1, $2, 'pending', $3)`,
    [id, apiVersionId, JSON.stringify(plan)],
  );

  return { runId: id, plan };
}

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

/** Create a Run from user-defined steps (from the web workflow editor). */
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
    planHash: '0'.repeat(64),
    workflowVersionId: id,
    compiledAt: now,
    steps,
  };

  // Insert into DB (api_version_id is null for custom runs)
  pool
    .query(
      `INSERT INTO runs (id, api_version_id, status, plan_json)
     VALUES ($1, NULL, 'pending', $2)`,
      [id, JSON.stringify(plan)],
    )
    .catch((err) => console.error('[run] Failed to insert run:', err));

  return { runId: id, plan };
}

/** Get a run by ID. */
export async function getRun(id: string) {
  const result = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    apiVersionId: row.api_version_id,
    status: row.status,
    plan: row.plan_json,
    runnerId: row.runner_id,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** List all runs, newest first. */
export async function listRuns(limit = 50) {
  const result = await pool.query(
    `SELECT id, api_version_id, status, runner_id, claimed_at, created_at, finished_at
     FROM runs ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    id: row.id,
    apiVersionId: row.api_version_id,
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
export async function createRunFromWorkflow(workflowVersionId: string) {
  // Load the compiled plan from the workflow version
  const versionResult = await pool.query(
    `SELECT id, workflow_id, version, compiled_plan
     FROM workflow_versions
     WHERE id = $1 AND compiled_plan IS NOT NULL`,
    [workflowVersionId],
  );

  if (versionResult.rows.length === 0) {
    throw new Error(`Workflow version ${workflowVersionId} not found or has no compiled plan`);
  }

  const row = versionResult.rows[0]!;
  const plan = row.compiled_plan as ExecutionPlan;

  // Ensure the plan has the correct workflow version ID
  plan.workflowVersionId = workflowVersionId;

  const id = runId();

  await pool.query(
    `INSERT INTO runs (id, workflow_version_id, status, plan_json)
     VALUES ($1, $2, 'pending', $3)`,
    [id, workflowVersionId, JSON.stringify(plan)],
  );

  return { runId: id, plan, workflowVersionId };
}
