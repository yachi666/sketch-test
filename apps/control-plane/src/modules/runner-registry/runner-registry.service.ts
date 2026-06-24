/**
 * Runner Registry Service
 *
 * Manages runner lifecycle: registration, heartbeat, status, and deregistration.
 * Runner tokens are stored in-memory (Map) — this is a dev-mode limitation.
 * In production, tokens should be hashed and stored in the database.
 *
 * Invariants:
 * - Tokens are generated with crypto.randomBytes for unpredictability.
 * - A runner can only belong to one workspace.
 * - Heartbeat updates last_heartbeat and sets status to 'online'.
 */

import crypto from 'node:crypto';
import { pool } from '../../db/db.js';
import { runnerId } from '../../shared/id.js';

// ── In-memory token store (dev mode) ──
// Map<token, { runnerId: string; workspaceId: string }>
// NOTE: In production, tokens should be hashed (e.g. SHA-256) and stored
// in a database table with expiration, scopes, and revocation support.
export const runnerTokens = new Map<string, { runnerId: string; workspaceId: string }>();

export interface RunnerRecord {
  id: string;
  workspaceId: string;
  name: string;
  version: string;
  labels: string[];
  status: 'online' | 'offline' | 'draining';
  lastHeartbeat: string | null;
  createdAt: string;
}

interface RunnerRow {
  id: string;
  workspace_id: string;
  name: string;
  version: string;
  labels: unknown;
  status: string;
  last_heartbeat: string | null;
  created_at: string;
}

function toRunnerRecord(row: RunnerRow): RunnerRecord {
  let labels: string[] = [];
  if (Array.isArray(row.labels)) {
    labels = row.labels as string[];
  } else if (typeof row.labels === 'string') {
    try {
      labels = JSON.parse(row.labels);
    } catch {
      labels = [];
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    version: row.version,
    labels,
    status: row.status as RunnerRecord['status'],
    lastHeartbeat: row.last_heartbeat,
    createdAt: row.created_at,
  };
}

function generateToken(): string {
  return `sk-${crypto.randomBytes(24).toString('hex')}`;
}

/** Register a new runner and return its ID + auth token. */
export async function registerRunner(
  workspaceId: string,
  name: string,
  version = '0.1.0',
  labels: string[] = [],
): Promise<{ id: string; token: string }> {
  const id = runnerId();
  const token = generateToken();

  await pool.query(
    `INSERT INTO runners (id, workspace_id, name, version, labels, status)
     VALUES ($1, $2, $3, $4, $5, 'offline')`,
    [id, workspaceId, name, version, JSON.stringify(labels)],
  );

  runnerTokens.set(token, { runnerId: id, workspaceId });
  return { id, token };
}

/** Get a runner by ID. */
export async function getRunner(id: string): Promise<RunnerRecord | null> {
  const result = await pool.query(`SELECT * FROM runners WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return toRunnerRecord(result.rows[0] as RunnerRow);
}

/** List all runners in a workspace. */
export async function listRunners(workspaceId: string): Promise<RunnerRecord[]> {
  const result = await pool.query(
    `SELECT * FROM runners WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map((row) => toRunnerRecord(row as RunnerRow));
}

/** Record a heartbeat for a runner. Updates last_heartbeat and sets status to 'online'. */
export async function recordHeartbeat(
  runnerId: string,
  capacity?: Record<string, unknown>,
): Promise<void> {
  await pool.query(`UPDATE runners SET last_heartbeat = now(), status = 'online' WHERE id = $1`, [
    runnerId,
  ]);

  await pool.query(`INSERT INTO runner_heartbeats (runner_id, capacity) VALUES ($1, $2)`, [
    runnerId,
    capacity ? JSON.stringify(capacity) : '{}',
  ]);
}

/** Update runner status. */
export async function updateRunnerStatus(
  runnerId: string,
  status: 'online' | 'offline' | 'draining',
): Promise<RunnerRecord | null> {
  const result = await pool.query(`UPDATE runners SET status = $1 WHERE id = $2 RETURNING *`, [
    status,
    runnerId,
  ]);
  if (result.rows.length === 0) return null;
  return toRunnerRecord(result.rows[0] as RunnerRow);
}

/** Delete a runner and its tokens. */
export async function deleteRunner(id: string): Promise<void> {
  // Remove all tokens associated with this runner
  for (const [token, data] of runnerTokens) {
    if (data.runnerId === id) {
      runnerTokens.delete(token);
    }
  }

  await pool.query(`DELETE FROM runner_heartbeats WHERE runner_id = $1`, [id]);
  await pool.query(`DELETE FROM runners WHERE id = $1`, [id]);
}

/** Verify a runner token and return the associated runner info. */
export function verifyRunnerToken(token: string): { runnerId: string; workspaceId: string } | null {
  return runnerTokens.get(token) ?? null;
}

/** Find runners by label in a workspace. */
export async function getRunnersByLabel(
  workspaceId: string,
  label: string,
): Promise<RunnerRecord[]> {
  const result = await pool.query(
    `SELECT * FROM runners WHERE workspace_id = $1 AND labels @> $2::jsonb ORDER BY created_at DESC`,
    [workspaceId, JSON.stringify([label])],
  );
  return result.rows.map((row) => toRunnerRecord(row as RunnerRow));
}
