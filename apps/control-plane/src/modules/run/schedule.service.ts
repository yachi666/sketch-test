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

import { pool } from '../../db/db.js';
import { generateId } from '../../shared/id.js';
import { runId } from '../../shared/id.js';

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
     VALUES ($1, $2, $3, $4, $5, $6)
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

  return toSchedule(result.rows[0]!);
}

/** List schedules, optionally filtered by workspace. */
export async function listSchedules(workspaceId?: string): Promise<Schedule[]> {
  let query = 'SELECT * FROM schedule_configs';
  const params: string[] = [];

  if (workspaceId) {
    query += ' WHERE workspace_id = $1';
    params.push(workspaceId);
  }

  query += ' ORDER BY created_at DESC LIMIT 100';

  const result = await pool.query<ScheduleRow>(query, params);
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
 * Creates a new run from the schedule's test suite and returns the run ID.
 */
export async function triggerSchedule(id: string): Promise<string | null> {
  const schedule = await getSchedule(id);
  if (!schedule) return null;

  const newRunId = runId();
  const now = new Date().toISOString();

  // Build a minimal plan referencing the test suite
  const plan = {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId: newRunId,
    planHash: '0'.repeat(64),
    workflowVersionId: schedule.testSuiteId,
    compiledAt: now,
    steps: [] as Array<Record<string, unknown>>,
  };

  await pool.query(
    `INSERT INTO runs (id, api_version_id, status, plan_json, created_at)
     VALUES ($1, NULL, 'pending', $2, $3)`,
    [newRunId, JSON.stringify(plan), now],
  );

  return newRunId;
}

/**
 * Find all enabled schedules whose cron expression matches the current time
 * (within a 1-minute window).
 */
export async function getDueSchedules(): Promise<Schedule[]> {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);
  const oneMinuteAhead = new Date(now.getTime() + 60_000);

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
