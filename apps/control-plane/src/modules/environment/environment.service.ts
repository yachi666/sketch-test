/**
 * Environment & Secret Management — Business Logic
 *
 * Schema version: environment-service/v1
 *
 * Invariants:
 * - Secrets are encrypted at rest using AES-256-GCM with a server-side key.
 * - Secret references in environment variables (${secret.NAME}) are resolved to
 *   ***SECRET*** placeholders in API responses — actual decryption happens on Runner.
 * - Environment deletion is blocked if any schedule_configs reference it.
 * - Version numbers auto-increment per environment (not globally).
 *
 * DEV-GRADE ENCRYPTION NOTE:
 *   The encryption here uses a static key from SECRET_KEY env var (defaulting to
 *   'sketch-test-dev-key-32chr!!'). The key is padded/truncated to exactly 32 bytes.
 *   This is NOT production-grade key management. Before production, replace with:
 *   - A KMS-backed key provider (AWS KMS, HashiCorp Vault, etc.)
 *   - Per-workspace or per-secret derived keys
 *   - Secure key rotation support
 */

import crypto from 'node:crypto';
import { pool } from '../../db/db.js';
import { environmentId, environmentVersionId, secretId } from '../../shared/id.js';

// ── Encryption utilities ──

const DEV_KEY = 'sketch-test-dev-key-32chr!!';
let _encryptionKeyChecked = false;

function getEncryptionKey(): Buffer {
  const raw = process.env['SECRET_KEY'];
  if (!raw) {
    if (!_encryptionKeyChecked) {
      console.warn(
        '[security] SECRET_KEY env var not set — using default dev key. ' +
          'Set SECRET_KEY to a strong random value before deploying to production.',
      );
      _encryptionKeyChecked = true;
    }
  }
  if (raw && raw === DEV_KEY) {
    if (!_encryptionKeyChecked) {
      console.warn(
        '[security] SECRET_KEY is set to the default dev value — ' +
          'this is not safe for production. Generate a unique key.',
      );
      _encryptionKeyChecked = true;
    }
  }
  const keySource = raw ?? DEV_KEY;
  let key = keySource;
  if (key.length < 32) key = key.padEnd(32, '0');
  if (key.length > 32) key = key.slice(0, 32);
  return Buffer.from(key, 'utf8');
}

/**
 * Encrypt a plaintext value using AES-256-GCM.
 * Returns a colon-separated hex string: iv:authTag:ciphertext
 */
function encrypt(value: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(value, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a value previously encrypted with encrypt().
 * Used by the Runner-side decrypt endpoint with short-lived auth.
 */
export function decryptSecret(encryptedValue: string): string {
  const key = getEncryptionKey();
  const parts = encryptedValue.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }
  const [ivHex, authTagHex, encryptedHex] = parts as [string, string, string];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Secret reference resolution ──

const SECRET_REF_PATTERN = /\$\{secret\.([A-Za-z_][A-Za-z0-9_]*)\}/;

/**
 * Scan variables for ${secret.NAME} references and replace with ***SECRET***.
 * Actual decryption happens on the Runner side.
 */
function resolveSecretRefs(variables: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string' && SECRET_REF_PATTERN.test(value)) {
      resolved[key] = '***SECRET***';
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ── Types ──

export interface Environment {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface EnvironmentVersion {
  id: string;
  environmentId: string;
  version: number;
  baseUrl: string;
  variables: Record<string, unknown>;
  runnerLabels: string[];
  requireApproval: boolean;
  createdAt: string;
}

export interface Secret {
  id: string;
  workspaceId: string;
  name: string;
  encryptedValue?: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

// ── Row mappers (snake_case DB → camelCase API) ──

function mapEnvironmentRow(row: Record<string, unknown>): Environment {
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? '',
    createdAt: (row['created_at'] as string) ?? '',
  };
}

function mapEnvironmentVersionRow(row: Record<string, unknown>): EnvironmentVersion {
  return {
    id: row['id'] as string,
    environmentId: row['environment_id'] as string,
    version: row['version'] as number,
    baseUrl: (row['base_url'] as string) ?? '',
    variables: (row['variables'] as Record<string, unknown>) ?? {},
    runnerLabels: (row['runner_labels'] as string[]) ?? [],
    requireApproval: (row['require_approval'] as boolean) ?? false,
    createdAt: (row['created_at'] as string) ?? '',
  };
}

function mapSecretRow(row: Record<string, unknown>): Secret {
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    encryptedValue: row['encrypted_value'] as string | undefined,
    description: (row['description'] as string) ?? '',
    createdAt: (row['created_at'] as string) ?? '',
    updatedAt: (row['updated_at'] as string) ?? '',
  };
}

// ── Environment CRUD ──

/**
 * Create a new environment and its initial version (version 1).
 * Both inserts happen in a transaction.
 */
export async function createEnvironment(
  workspaceId: string,
  name: string,
  description = '',
): Promise<Environment> {
  const envId = environmentId();
  const versionId = environmentVersionId();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO environments (id, workspace_id, name, description)
       VALUES ($1, $2, $3, $4)`,
      [envId, workspaceId, name, description],
    );
    await client.query(
      `INSERT INTO environment_versions (id, environment_id, version, base_url)
       VALUES ($1, $2, 1, '')`,
      [versionId, envId],
    );
    await client.query('COMMIT');

    const result = await pool.query(`SELECT * FROM environments WHERE id = $1`, [envId]);
    return mapEnvironmentRow(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Get an environment by ID. */
export async function getEnvironment(id: string): Promise<Environment | null> {
  const result = await pool.query(`SELECT * FROM environments WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return mapEnvironmentRow(result.rows[0]);
}

/** List all environments in a workspace. */
export async function listEnvironments(workspaceId: string): Promise<Environment[]> {
  const result = await pool.query(
    `SELECT * FROM environments WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(mapEnvironmentRow);
}

/** Update an environment's name and/or description. */
export async function updateEnvironment(
  id: string,
  name?: string,
  description?: string,
): Promise<Environment | null> {
  const setClauses: string[] = [];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(name);
  }
  if (description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    params.push(description);
  }

  if (setClauses.length === 0) return getEnvironment(id);

  params.push(id);
  const result = await pool.query(
    `UPDATE environments SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING *`,
    params,
  );
  if (result.rows.length === 0) return null;
  return mapEnvironmentRow(result.rows[0]);
}

/** Delete an environment. Blocked if any schedule_configs reference it. */
export async function deleteEnvironment(id: string): Promise<boolean> {
  // Check for references in schedule_configs
  const scheduleCheck = await pool.query(
    `SELECT COUNT(*) as count FROM schedule_configs WHERE environment_id = $1`,
    [id],
  );
  if (parseInt(scheduleCheck.rows[0]['count'] as string, 10) > 0) {
    throw new Error('Cannot delete environment: it is referenced by one or more schedules');
  }

  const result = await pool.query(`DELETE FROM environments WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

// ── Environment Version CRUD ──

/**
 * Create a new version of an environment. Version number auto-increments.
 */
export async function createEnvironmentVersion(
  environmentId: string,
  baseUrl: string,
  variables: Record<string, unknown> = {},
  runnerLabels: string[] = [],
  requireApproval = false,
): Promise<EnvironmentVersion> {
  // Get next version number
  const maxResult = await pool.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM environment_versions WHERE environment_id = $1`,
    [environmentId],
  );
  const nextVersion = parseInt(maxResult.rows[0]['next_version'] as string, 10);

  const id = environmentVersionId();
  await pool.query(
    `INSERT INTO environment_versions
       (id, environment_id, version, base_url, variables, runner_labels, require_approval)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      environmentId,
      nextVersion,
      baseUrl,
      JSON.stringify(variables),
      JSON.stringify(runnerLabels),
      requireApproval,
    ],
  );

  const result = await pool.query(`SELECT * FROM environment_versions WHERE id = $1`, [id]);
  const version = mapEnvironmentVersionRow(result.rows[0]);
  // Resolve secret refs for safe display
  version.variables = resolveSecretRefs(version.variables);
  return version;
}

/**
 * Get a specific environment version by ID.
 * Secret references are resolved to ***SECRET*** placeholders.
 */
export async function getEnvironmentVersion(id: string): Promise<EnvironmentVersion | null> {
  const result = await pool.query(`SELECT * FROM environment_versions WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const version = mapEnvironmentVersionRow(result.rows[0]);
  version.variables = resolveSecretRefs(version.variables);
  return version;
}

/** List all versions for an environment, newest first. */
export async function listEnvironmentVersions(
  environmentId: string,
): Promise<EnvironmentVersion[]> {
  const result = await pool.query(
    `SELECT * FROM environment_versions
     WHERE environment_id = $1 ORDER BY version DESC`,
    [environmentId],
  );
  return result.rows.map(mapEnvironmentVersionRow);
}

/** Get the latest (highest version number) version of an environment. */
export async function getLatestEnvironmentVersion(
  environmentId: string,
): Promise<EnvironmentVersion | null> {
  const result = await pool.query(
    `SELECT * FROM environment_versions
     WHERE environment_id = $1 ORDER BY version DESC LIMIT 1`,
    [environmentId],
  );
  if (result.rows.length === 0) return null;
  const version = mapEnvironmentVersionRow(result.rows[0]);
  version.variables = resolveSecretRefs(version.variables);
  return version;
}

// ── Secret CRUD ──

/** Create a new secret with encrypted value. */
export async function createSecret(
  workspaceId: string,
  name: string,
  value: string,
  description = '',
): Promise<Secret> {
  const id = secretId();
  const encryptedValue = encrypt(value);

  await pool.query(
    `INSERT INTO secrets (id, workspace_id, name, encrypted_value, description)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, workspaceId, name, encryptedValue, description],
  );

  const result = await pool.query(`SELECT * FROM secrets WHERE id = $1`, [id]);
  return mapSecretRow(result.rows[0]);
}

/** Get a secret by ID (includes encrypted_value for internal use). */
export async function getSecret(id: string): Promise<Secret | null> {
  const result = await pool.query(`SELECT * FROM secrets WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  return mapSecretRow(result.rows[0]);
}

/** List secrets in a workspace. encrypted_value is included internally. */
export async function listSecrets(workspaceId: string): Promise<Secret[]> {
  const result = await pool.query(
    `SELECT * FROM secrets WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(mapSecretRow);
}

/** Update a secret's value and optionally its description. */
export async function updateSecret(
  id: string,
  value: string,
  description?: string,
): Promise<Secret | null> {
  const encryptedValue = encrypt(value);

  const setClauses: string[] = ['encrypted_value = $1', 'updated_at = now()'];
  const params: (string | number)[] = [encryptedValue];
  let paramIndex = 2;

  if (description !== undefined) {
    setClauses.push(`description = $${paramIndex++}`);
    params.push(description);
  }

  params.push(id);
  const result = await pool.query(
    `UPDATE secrets SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING *`,
    params,
  );
  if (result.rows.length === 0) return null;
  return mapSecretRow(result.rows[0]);
}

/** Delete a secret by ID. */
export async function deleteSecret(id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM secrets WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
