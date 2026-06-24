/**
 * IAM Service — business logic and database queries for Identity & Access Management.
 *
 * Covers workspaces, users (with scrypt password hashing), and service accounts.
 * All database access goes through the shared pg pool — no ORM.
 */

import crypto from 'node:crypto';
import { pool } from '../../db/db.js';
import { workspaceId, userId, serviceAccountId } from '../../shared/id.js';

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
interface ServiceAccountWithHash extends ServiceAccount {
  tokenHash: string;
}

// ── Password hashing (scrypt, dev-salt) ────────────────────────────────────────

const SCRYPT_SALT = 'sketch-test-salt';
const SCRYPT_KEYLEN = 64;
const PASSWORD_SUFFIX = ':sketch-test-salt';

function hashPassword(password: string): string {
  return crypto.scryptSync(password + PASSWORD_SUFFIX, SCRYPT_SALT, SCRYPT_KEYLEN).toString('hex');
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
  description?: string,
): Promise<{ workspace: Workspace; adminUser: User }> {
  const wsId = workspaceId();
  const adminId = userId();
  const now = new Date().toISOString();
  const passwordHash = hashPassword('admin');
  const descriptionText = description ?? '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO workspaces (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [wsId, name, descriptionText, now, now],
    );

    await client.query(
      `INSERT INTO users (id, workspace_id, email, password_hash, display_name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, wsId, 'admin@workspace', passwordHash, 'Admin', 'owner', now],
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
        email: 'admin@workspace',
        displayName: 'Admin',
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
  const passwordHash = hashPassword(password);
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
export function verifyPassword(user: UserWithHash, password: string): boolean {
  const computed = Buffer.from(hashPassword(password), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  return timingSafeEqual(computed, stored);
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
  const now = new Date().toISOString();
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

function rowToServiceAccountWithHash(row: Record<string, unknown>): ServiceAccountWithHash {
  return {
    ...rowToServiceAccount(row),
    tokenHash: row['token_hash'] as string,
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
