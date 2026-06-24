/**
 * Runner Registry Service
 *
 * Manages runner lifecycle: registration, heartbeat, status, and deregistration.
 * Runner tokens are SHA-256 hashed and stored in the `runner_tokens` table —
 * raw tokens are never persisted. Token verification hashes the incoming token
 * and looks up the hash.
 *
 * A legacy in-memory fallback (runnerTokens Map) is retained for dev convenience
 * but new registrations use the database.
 *
 * Invariants:
 * - Tokens are generated with crypto.randomBytes for unpredictability.
 * - Only SHA-256(token) is stored — raw tokens are not recoverable from DB.
 * - A runner can only belong to one workspace.
 * - Heartbeat updates last_heartbeat and sets status to 'online'.
 */

import crypto from 'node:crypto';
import { pool } from '../../db/db.js';
import { runnerId } from '../../shared/id.js';

// ── Token hashing ───────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Legacy in-memory token store (for backward compat) ──────────────

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

  // Store token hash in DB
  const tokenHash = hashToken(token);
  await pool.query(
    `INSERT INTO runner_tokens (token_hash, runner_id, workspace_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO NOTHING`,
    [tokenHash, id, workspaceId],
  );
  // Also keep in legacy map for transition
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
  // DB cascade handles runner_tokens, but clean up explicitly for safety
  await pool.query(`DELETE FROM runner_tokens WHERE runner_id = $1`, [id]);
  await pool.query(`DELETE FROM runner_heartbeats WHERE runner_id = $1`, [id]);
  await pool.query(`DELETE FROM runners WHERE id = $1`, [id]);
  // Legacy in-memory cleanup
  for (const [token, data] of runnerTokens) {
    if (data.runnerId === id) {
      runnerTokens.delete(token);
    }
  }
}

/** Verify a runner token and return the associated runner info.
 *  Checks the `runner_tokens` DB table first, then falls back to in-memory legacy store. */
export async function verifyRunnerToken(
  token: string,
): Promise<{ runnerId: string; workspaceId: string } | null> {
  // Check DB first (hashing the token)
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `SELECT runner_id, workspace_id FROM runner_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  if (result.rows.length > 0) {
    return {
      runnerId: result.rows[0].runner_id,
      workspaceId: result.rows[0].workspace_id,
    };
  }
  // Fall back to legacy in-memory store
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
