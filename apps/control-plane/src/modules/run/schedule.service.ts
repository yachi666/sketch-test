/**
 * Schedule service — cron-based test suite scheduling.
 *
 * Manages schedule_configs rows and provides cron expression matching.
 * The cron parser supports the 5-field standard format:
 *   minute hour day month weekday
 *
 * Supports: wildcard (*), exact numbers, every-N intervals, comma-separated
 * values, and ranges (N-M).
 */

import { type ExecutionPlan, ExecutionPlanSchema } from '@sketch-test/runner-protocol';
import { pool } from '../../db/db.js';
import { executionPlanContentHash } from '../../shared/execution-plan-hash.js';
import { generateId, runId } from '../../shared/id.js';
import { compileTestCaseVersionPlan, TestPlanCompileError } from './test-plan-compiler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleRow {
  id: string;
  workspace_id: string;
  test_suite_id: string;
  cron_expression: string;
  environment_id: string | null;
  enabled: boolean;
  created_at: string;
}

export interface Schedule {
  id: string;
  workspaceId: string;
  testSuiteId: string;
  cronExpression: string;
  environmentId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface ScheduleCreateInput {
  workspaceId: string;
  testSuiteId: string;
  cronExpression: string;
  environmentId?: string;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  cronExpression?: string;
  environmentId?: string | null;
  enabled?: boolean;
}

export interface ScheduleTriggerResult {
  testSuiteVersionId: string;
  runIds: string[];
}

export class ScheduleTriggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleTriggerError';
  }
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function scheduleId(): string {
  return generateId('sched');
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    testSuiteId: row.test_suite_id,
    cronExpression: row.cron_expression,
    environmentId: row.environment_id,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/** Create a new schedule configuration. */
export async function createSchedule(input: ScheduleCreateInput): Promise<Schedule> {
  const id = scheduleId();

  const result = await pool.query<ScheduleRow>(
    `INSERT INTO schedule_configs (id, workspace_id, test_suite_id, cron_expression, environment_id, enabled)
     SELECT $1, $2, suite.id, $4, $5, $6
     FROM test_suites suite
     WHERE suite.id = $3 AND suite.workspace_id = $2
       AND (
         $5::text IS NULL OR EXISTS (
           SELECT 1 FROM environments environment
           WHERE environment.id = $5 AND environment.workspace_id = $2
         )
       )
     RETURNING *`,
    [
      id,
      input.workspaceId,
      input.testSuiteId,
      input.cronExpression,
      input.environmentId ?? null,
      input.enabled ?? true,
    ],
  );

  if (result.rows.length === 0) {
    throw new ScheduleTriggerError('Test suite or environment not found in workspace');
  }

  return toSchedule(result.rows[0]!);
}

/** List schedules in one workspace. */
export async function listSchedules(workspaceId: string): Promise<Schedule[]> {
  const result = await pool.query<ScheduleRow>(
    `SELECT * FROM schedule_configs
     WHERE workspace_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [workspaceId],
  );
  return result.rows.map(toSchedule);
}

/** Update an existing schedule. Returns null if not found. */
export async function updateSchedule(
  id: string,
  updates: ScheduleUpdateInput,
): Promise<Schedule | null> {
  const sets: string[] = [];
  const params: (string | boolean | null)[] = [];
  let paramIndex = 1;

  if (updates.cronExpression !== undefined) {
    sets.push(`cron_expression = $${paramIndex++}`);
    params.push(updates.cronExpression);
  }
  if (updates.environmentId !== undefined) {
    sets.push(`environment_id = $${paramIndex++}`);
    params.push(updates.environmentId);
  }
  if (updates.enabled !== undefined) {
    sets.push(`enabled = $${paramIndex++}`);
    params.push(updates.enabled);
  }

  if (sets.length === 0) {
    // No updates to apply; return existing schedule
    return getSchedule(id);
  }

  params.push(id);
  const query = `UPDATE schedule_configs SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

  const result = await pool.query<ScheduleRow>(query, params);
  if (result.rows.length === 0) return null;
  return toSchedule(result.rows[0]!);
}

/** Delete a schedule. Returns true if deleted, false if not found. */
export async function deleteSchedule(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM schedule_configs WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Get a single schedule by ID. */
export async function getSchedule(id: string): Promise<Schedule | null> {
  const result = await pool.query<ScheduleRow>('SELECT * FROM schedule_configs WHERE id = $1', [
    id,
  ]);
  if (result.rows.length === 0) return null;
  return toSchedule(result.rows[0]!);
}

// ---------------------------------------------------------------------------
// Cron matching
// ---------------------------------------------------------------------------

/**
 * Check if a single cron field matches a time value.
 *
 * Supports:
 *  - * (wildcard)
 *  - N (exact number)
 *  - every-N (every N steps, starting from 0)
 *  - N-M (range inclusive)
 *  - N,M,O (comma-separated list)
 */
function cronFieldMatches(field: string, value: number): boolean {
  const parts = field.split(',');
  for (const part of parts) {
    const trimmed = part.trim();

    // */N format: every N steps
    if (trimmed.startsWith('*/')) {
      const interval = parseInt(trimmed.slice(2), 10);
      if (!isNaN(interval) && interval > 0 && value % interval === 0) {
        return true;
      }
      continue;
    }

    // N-M format: range
    if (trimmed.includes('-')) {
      const dashIdx = trimmed.indexOf('-');
      const startStr = trimmed.slice(0, dashIdx);
      const endStr = trimmed.slice(dashIdx + 1);
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && value >= start && value <= end) {
        return true;
      }
      continue;
    }

    // Wildcard
    if (trimmed === '*') return true;

    // Exact number
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num === value) return true;
  }

  return false;
}

/**
 * Test whether a 5-field cron expression matches a given date.
 *
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31), month (1-12),
 * day-of-week (0-6, 0=Sunday).
 *
 * Uses UTC to avoid timezone ambiguity.
 */
export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minStr, hourStr, domStr, monthStr, dowStr] = fields;
  if (!minStr || !hourStr || !domStr || !monthStr || !dowStr) return false;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-12
  const dow = date.getUTCDay(); // 0-6, 0=Sunday

  return (
    cronFieldMatches(minStr, minute) &&
    cronFieldMatches(hourStr, hour) &&
    cronFieldMatches(domStr, dom) &&
    cronFieldMatches(monthStr, month) &&
    cronFieldMatches(dowStr, dow)
  );
}

/** Validate a cron expression format. */
export function isValidCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const validators: Array<{ min: number; max: number }> = [
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 1, max: 12 }, // month
    { min: 0, max: 6 }, // day of week
  ];

  for (let i = 0; i < 5; i++) {
    const field = fields[i]!;
    const range = validators[i]!;

    const parts = field.split(',');
    for (const part of parts) {
      const trimmed = part.trim();

      if (trimmed === '*') continue;

      if (trimmed.startsWith('*/')) {
        const interval = parseInt(trimmed.slice(2), 10);
        if (isNaN(interval) || interval <= 0) return false;
        continue;
      }

      if (trimmed.includes('-')) {
        const dashIdx = trimmed.indexOf('-');
        const start = parseInt(trimmed.slice(0, dashIdx), 10);
        const end = parseInt(trimmed.slice(dashIdx + 1), 10);
        if (isNaN(start) || isNaN(end) || start < range.min || end > range.max || start > end) {
          return false;
        }
        continue;
      }

      const num = parseInt(trimmed, 10);
      if (isNaN(num) || num < range.min || num > range.max) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Trigger & due checking
// ---------------------------------------------------------------------------

/**
 * Manually trigger a scheduled run immediately.
 * Creates one immutable Run for every member in the latest TestSuiteVersion.
 */
export async function triggerSchedule(id: string): Promise<ScheduleTriggerResult | null> {
  const schedule = await getSchedule(id);
  if (!schedule) return null;

  const versionResult = await pool.query<{
    id: string;
    members_json: Array<{ type: 'test' | 'workflow'; id: string }>;
  }>(
    `SELECT id, members_json
     FROM test_suite_versions
     WHERE test_suite_id = $1
     ORDER BY version DESC
     LIMIT 1`,
    [schedule.testSuiteId],
  );

  const suiteVersion = versionResult.rows[0];
  if (!suiteVersion) {
    throw new ScheduleTriggerError(
      `Test suite ${schedule.testSuiteId} has no version and cannot be scheduled`,
    );
  }

  const members = suiteVersion.members_json ?? [];
  if (members.length === 0) {
    throw new ScheduleTriggerError(`Test suite version ${suiteVersion.id} has no members`);
  }

  const plans: ExecutionPlan[] = [];
  for (const member of members) {
    if (member.type === 'test') {
      const testResult = await pool.query<{ id: string; definition: unknown }>(
        `SELECT id, definition
         FROM test_case_versions
         WHERE test_case_id = $1 AND published_by IS NOT NULL
         ORDER BY version DESC
         LIMIT 1`,
        [member.id],
      );
      const testVersion = testResult.rows[0];
      if (!testVersion) {
        throw new ScheduleTriggerError(`TestCase ${member.id} has no published TestCaseVersion`);
      }
      try {
        plans.push(compileTestCaseVersionPlan(testVersion.id, testVersion.definition));
      } catch (error) {
        if (error instanceof TestPlanCompileError) {
          throw new ScheduleTriggerError(error.message);
        }
        throw error;
      }
      continue;
    }

    const planResult = await pool.query<{ compiled_plan: unknown }>(
      `SELECT compiled_plan
       FROM workflow_versions
       WHERE workflow_id = $1 AND compiled_plan IS NOT NULL
       ORDER BY version DESC
       LIMIT 1`,
      [member.id],
    );
    const storedPlan = planResult.rows[0]?.compiled_plan;
    const parsed = ExecutionPlanSchema.safeParse(storedPlan);
    if (!parsed.success) {
      throw new ScheduleTriggerError(`Workflow ${member.id} has no valid published ExecutionPlan`);
    }

    // Verify the exact stored representation. Zod applies protocol defaults
    // while parsing; hashing the parsed value would incorrectly reject older
    // valid plans that omit optional fields with defaults.
    const storedContent = storedPlan as ExecutionPlan;
    const expectedHash = executionPlanContentHash(
      storedContent.steps,
      storedContent.teardown?.steps,
    );
    if (parsed.data.planHash !== expectedHash) {
      throw new ScheduleTriggerError(
        `Workflow ${member.id} has an ExecutionPlan with an invalid content hash`,
      );
    }
    // Preserve the immutable published representation. Normalizing defaults
    // here would change executable content without updating its content hash.
    plans.push(storedContent);
  }

  const client = await pool.connect();
  const runIds: string[] = [];
  try {
    await client.query('BEGIN');
    for (const plan of plans) {
      const newRunId = runId();
      runIds.push(newRunId);
      await client.query(
        `INSERT INTO runs
          (id, workspace_id, workflow_version_id, test_case_version_id, status, plan_json)
         VALUES ($1, $2, $3, $4, 'pending', $5)`,
        [
          newRunId,
          schedule.workspaceId,
          plan.workflowVersionId ?? null,
          plan.testCaseVersionId ?? null,
          JSON.stringify(plan),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { testSuiteVersionId: suiteVersion.id, runIds };
}

/**
 * Find all enabled schedules whose cron expression matches the current time
 * (within a 1-minute window).
 */
export async function getDueSchedules(): Promise<Schedule[]> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);
  const result = await pool.query<ScheduleRow>(
    `SELECT * FROM schedule_configs WHERE enabled = true ORDER BY created_at`,
  );

  // Filter in application code since cron matching is not native SQL
  const due: Schedule[] = [];
  for (const row of result.rows) {
    const schedule = toSchedule(row);
    // Check current minute and the minute before (to handle edge cases)
    if (cronMatches(schedule.cronExpression, now)) {
      due.push(schedule);
    } else if (cronMatches(schedule.cronExpression, oneMinuteAgo)) {
      due.push(schedule);
    }
  }

  return due;
}
