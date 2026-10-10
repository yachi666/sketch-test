/**
 * IAM Service — business logic and database queries for Identity & Access Management.
 *
 * Covers workspaces, users (with scrypt password hashing), and service accounts.
 * All database access goes through the shared pg pool — no ORM.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from '../../db/db.js';
import { serviceAccountId, userId, workspaceId } from '../../shared/id.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'maintainer' | 'editor' | 'viewer';
  createdAt: string;
}

/** User row including the password hash — only used internally for auth. */
interface UserWithHash extends User {
  passwordHash: string;
}

export interface ServiceAccount {
  id: string;
  workspaceId: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** Service account row including token hash — only used internally. */
// ── Password hashing (scrypt with per-password random salt) ───────────────────

const SCRYPT_PREFIX = 'scrypt-v1';
const SCRYPT_KEYLEN = 64;
const LEGACY_SCRYPT_SALT = 'sketch-test-salt';
const PASSWORD_SUFFIX = ':sketch-test-salt';
const scrypt = promisify(crypto.scrypt);

async function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = await derivePasswordKey(password, salt);
  return `${SCRYPT_PREFIX}$${salt}$${derived.toString('hex')}`;
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Token generation ───────────────────────────────────────────────────────────

export function generateServiceToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ── Workspaces ─────────────────────────────────────────────────────────────────

/** Create a workspace with a default owner admin user. */
export async function createWorkspace(
  name: string,
  ownerEmail: string,
  ownerPassword: string,
  description?: string,
  ownerDisplayName = 'Owner',
  bootstrapOnly = false,
): Promise<{ workspace: Workspace; adminUser: User }> {
  const wsId = workspaceId();
  const adminId = userId();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(ownerPassword);
  const descriptionText = description ?? '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (bootstrapOnly) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('sketchtest-workspace-bootstrap'))`,
      );
      const existing = await client.query(`SELECT EXISTS (SELECT 1 FROM workspaces) AS exists`);
      if (existing.rows[0]?.exists === true) {
        throw new Error('Workspace bootstrap already completed');
      }
    }

    await client.query(
      `INSERT INTO workspaces (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [wsId, name, descriptionText, now, now],
    );

    await client.query(
      `INSERT INTO users (id, workspace_id, email, password_hash, display_name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, wsId, ownerEmail, passwordHash, ownerDisplayName, 'owner', now],
    );

    await client.query('COMMIT');

    return {
      workspace: {
        id: wsId,
        name,
        description: descriptionText,
        createdAt: now,
        updatedAt: now,
      },
      adminUser: {
        id: adminId,
        workspaceId: wsId,
        email: ownerEmail,
        displayName: ownerDisplayName,
        role: 'owner',
        createdAt: now,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Get a workspace by ID, or null if not found. */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const result = await pool.query(`SELECT * FROM workspaces WHERE id = $1`, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

/** List all workspaces, newest first. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const result = await pool.query(`SELECT * FROM workspaces ORDER BY created_at DESC`);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}

// ── Users ──────────────────────────────────────────────────────────────────────

function rowToUser(row: Record<string, unknown>): User {
  const createdAt = row['created_at'];
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    email: row['email'] as string,
    displayName: row['display_name'] as string,
    role: row['role'] as User['role'],
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : (createdAt as string),
  };
}

function rowToUserWithHash(row: Record<string, unknown>): UserWithHash {
  return {
    ...rowToUser(row),
    passwordHash: row['password_hash'] as string,
  };
}

/** Create a user in a workspace. Password is hashed with scrypt. */
export async function createUser(
  workspaceId: string,
  email: string,
  password: string,
  displayName?: string,
  role?: User['role'],
): Promise<User> {
  const id = userId();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const display = displayName ?? email;
  const userRole = role ?? 'viewer';

  await pool.query(
    `INSERT INTO users (id, workspace_id, email, password_hash, display_name, role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, email, passwordHash, display, userRole, now],
  );

  return {
    id,
    workspaceId,
    email,
    displayName: display,
    role: userRole,
    createdAt: now,
  };
}

/** Get a user by ID, without the password hash. */
export async function getUser(id: string): Promise<User | null> {
  const result = await pool.query(
    `SELECT id, workspace_id, email, display_name, role, created_at
     FROM users WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

/** Get a user by email within a workspace, including the password hash (for login). */
export async function getUserByEmail(
  workspaceId: string,
  email: string,
): Promise<UserWithHash | null> {
  const result = await pool.query(
    `SELECT id, workspace_id, email, display_name, role, created_at, password_hash
     FROM users WHERE workspace_id = $1 AND email = $2`,
    [workspaceId, email],
  );
  if (result.rows.length === 0) return null;
  return rowToUserWithHash(result.rows[0]);
}

/**
 * Find a user by email across all workspaces.
 * Used for login when no workspaceId is specified.
 * Returns the first match, or null.
 */
export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const result = await pool.query(
    `SELECT id, workspace_id, email, display_name, role, created_at, password_hash
     FROM users WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (result.rows.length === 0) return null;
  return rowToUserWithHash(result.rows[0]);
}

/** Verify a plaintext password against a user's stored hash. */
export async function verifyPassword(user: UserWithHash, password: string): Promise<boolean> {
  const [prefix, salt, encodedHash, extra] = user.passwordHash.split('$');
  if (prefix === SCRYPT_PREFIX && salt && encodedHash && !extra) {
    const computed = await derivePasswordKey(password, salt);
    const stored = Buffer.from(encodedHash, 'hex');
    return timingSafeEqual(computed, stored);
  }

  // Accept the pre-release fixed-salt representation once so login can migrate it.
  const legacyComputed = await derivePasswordKey(password + PASSWORD_SUFFIX, LEGACY_SCRYPT_SALT);
  const legacyStored = Buffer.from(user.passwordHash, 'hex');
  return timingSafeEqual(legacyComputed, legacyStored);
}

/** Replace a legacy password hash after successful authentication. */
export async function upgradePasswordHash(user: UserWithHash, password: string): Promise<void> {
  if (user.passwordHash.startsWith(`${SCRYPT_PREFIX}$`)) return;
  await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
    user.id,
    await hashPassword(password),
  ]);
}

/** List all users in a workspace. */
export async function listUsers(workspaceId: string): Promise<User[]> {
  const result = await pool.query(
    `SELECT id, workspace_id, email, display_name, role, created_at
     FROM users WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToUser);
}

/** Update a user's role. Returns the updated user (without password hash). */
export async function updateUserRole(id: string, role: User['role']): Promise<User | null> {
  const result = await pool.query(
    `UPDATE users SET role = $2 WHERE id = $1
     RETURNING id, workspace_id, email, display_name, role, created_at`,
    [id, role],
  );
  if (result.rows.length === 0) return null;
  return rowToUser(result.rows[0]);
}

// ── Service Accounts ───────────────────────────────────────────────────────────

function rowToServiceAccount(row: Record<string, unknown>): ServiceAccount {
  const expiresAtVal = row['expires_at'];
  const createdAtVal = row['created_at'];
  const revokedAtVal = row['revoked_at'];
  return {
    id: row['id'] as string,
    workspaceId: row['workspace_id'] as string,
    name: row['name'] as string,
    scopes: (row['scopes'] as string[]) ?? [],
    expiresAt: expiresAtVal
      ? expiresAtVal instanceof Date
        ? expiresAtVal.toISOString()
        : (expiresAtVal as string)
      : null,
    createdAt: createdAtVal instanceof Date ? createdAtVal.toISOString() : (createdAtVal as string),
    revokedAt: revokedAtVal
      ? revokedAtVal instanceof Date
        ? revokedAtVal.toISOString()
        : (revokedAtVal as string)
      : null,
  };
}

/**
 * Create a service account. Generates a random token, stores its SHA-256 hash.
 * Returns the plaintext token — the caller must store it, as it cannot be retrieved later.
 */
export async function createServiceAccount(
  workspaceId: string,
  name: string,
  scopes?: string[],
  expiresAt?: string,
): Promise<{ id: string; name: string; token: string }> {
  const id = serviceAccountId();
  const now = new Date().toISOString();
  const rawToken = generateServiceToken();
  const tokenHash = hashToken(rawToken);
  const scopesJson = JSON.stringify(scopes ?? []);
  const expires = expiresAt ?? null;

  await pool.query(
    `INSERT INTO service_accounts (id, workspace_id, name, token_hash, scopes, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, workspaceId, name, tokenHash, scopesJson, expires, now],
  );

  return { id, name, token: rawToken };
}

/**
 * Verify a service account token. Hashes the incoming token and looks up the stored hash.
 * Returns the service account if the token is valid, active, and not expired.
 */
export async function verifyServiceAccountToken(token: string): Promise<ServiceAccount | null> {
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `SELECT id, workspace_id, name, token_hash, scopes, expires_at, created_at, revoked_at
     FROM service_accounts
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())`,
    [tokenHash],
  );
  if (result.rows.length === 0) return null;
  return rowToServiceAccount(result.rows[0]);
}

/** List all service accounts in a workspace (without token hashes). */
export async function listServiceAccounts(workspaceId: string): Promise<ServiceAccount[]> {
  const result = await pool.query(
    `SELECT id, workspace_id, name, scopes, expires_at, created_at, revoked_at
     FROM service_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
  return result.rows.map(rowToServiceAccount);
}

/** Revoke a service account by setting revoked_at to now. */
export async function revokeServiceAccount(id: string): Promise<void> {
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE service_accounts SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
    [id, now],
  );
}
