/**
 * IAM service unit tests.
 *
 * Tests password verification, token generation, and row mapping logic.
 * Database-dependent functions use a mocked pg pool.
 */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ─── Mock the database pool ────────────────────────────────────────

const mockQuery = vi.fn();
const mockConnect = vi.fn();

vi.mock('../../../db/db', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

// Mock id generators
vi.mock('../../../shared/id', () => {
  let counter = 0;
  return {
    workspaceId: () => `ws-${++counter}`,
    userId: () => `usr-${++counter}`,
    serviceAccountId: () => `sa-${++counter}`,
  };
});

import {
  createUser,
  findUserByEmail,
  generateServiceToken,
  getUser,
  getUserByEmail,
  getWorkspace,
  listServiceAccounts,
  listUsers,
  listWorkspaces,
  revokeServiceAccount,
  updateUserRole,
  verifyPassword,
  verifyServiceAccountToken,
} from '../iam.service';

// ─── Helpers ────────────────────────────────────────────────────────

function makeUserWithHash(
  overrides: { password?: string; passwordHash?: string } = {},
): Parameters<typeof verifyPassword>[0] {
  const password = overrides.password ?? 'test123';
  return {
    id: 'u-1',
    workspaceId: 'ws-1',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'editor',
    createdAt: '2026-01-01T00:00:00Z',
    passwordHash:
      overrides.passwordHash ??
      crypto.scryptSync(`${password}:sketch-test-salt`, 'sketch-test-salt', 64).toString('hex'),
  };
}

// ─── verifyPassword ───────────────────────────────────────────────

describe('verifyPassword', () => {
  test('returns true for a correct legacy password', async () => {
    const user = makeUserWithHash({ password: 'secret123' });
    await expect(verifyPassword(user, 'secret123')).resolves.toBe(true);
  });

  test('returns false for wrong password', async () => {
    const user = makeUserWithHash({ password: 'secret123' });
    await expect(verifyPassword(user, 'wrong-password')).resolves.toBe(false);
  });

  test('returns false for empty password', async () => {
    const user = makeUserWithHash({ password: 'secret123' });
    await expect(verifyPassword(user, '')).resolves.toBe(false);
  });

  test('returns false when hash length differs', async () => {
    const user = makeUserWithHash({ passwordHash: 'abc' });
    await expect(verifyPassword(user, 'anything')).resolves.toBe(false);
  });

  test('continues to verify pre-release fixed-salt hashes', async () => {
    const user1 = makeUserWithHash({ password: 'mypassword' });
    const user2 = makeUserWithHash({ password: 'mypassword' });

    await expect(verifyPassword(user1, 'mypassword')).resolves.toBe(true);
    await expect(verifyPassword(user2, 'mypassword')).resolves.toBe(true);
  });
});

// ─── generateServiceToken ─────────────────────────────────────────

describe('generateServiceToken', () => {
  test('generates a 64-character hex string', () => {
    const token = generateServiceToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  test('each call generates a unique token', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateServiceToken()));
    expect(tokens.size).toBe(100);
  });

  test('token does not contain non-hex characters', () => {
    for (let i = 0; i < 10; i++) {
      const token = generateServiceToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
    }
  });
});

// ─── getUser ──────────────────────────────────────────────────────

describe('getUser', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns a user when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-1',
          workspace_id: 'ws-1',
          email: 'a@b.com',
          display_name: 'Alice',
          role: 'editor',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const user = await getUser('u-1');

    expect(user).not.toBeNull();
    expect(user!.id).toBe('u-1');
    expect(user!.email).toBe('a@b.com');
    expect(user!.role).toBe('editor');
    expect(user!.displayName).toBe('Alice');
  });

  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const user = await getUser('non-existent');
    expect(user).toBeNull();
  });

  test('handles Date objects in created_at', async () => {
    const date = new Date('2026-01-15T00:00:00Z');
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-2',
          workspace_id: 'ws-1',
          email: 'b@c.com',
          display_name: 'Bob',
          role: 'viewer',
          created_at: date,
        },
      ],
    });

    const user = await getUser('u-2');
    expect(user!.createdAt).toBe('2026-01-15T00:00:00.000Z');
  });
});

// ─── getUserByEmail / findUserByEmail ─────────────────────────────

describe('getUserByEmail', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns user with password hash when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-3',
          workspace_id: 'ws-1',
          email: 'c@d.com',
          display_name: 'Charlie',
          role: 'maintainer',
          created_at: '2026-01-01T00:00:00Z',
          password_hash: 'hash123',
        },
      ],
    });

    const user = await getUserByEmail('ws-1', 'c@d.com');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('c@d.com');
    expect(user!.passwordHash).toBe('hash123');
  });

  test('returns null when email not found in workspace', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const user = await getUserByEmail('ws-1', 'no@match.com');
    expect(user).toBeNull();
  });

  test('queries with correct workspace and email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getUserByEmail('ws-target', 'target@email.com');

    const callArgs = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(callArgs[1][0]).toBe('ws-target');
    expect(callArgs[1][1]).toBe('target@email.com');
  });
});

describe('findUserByEmail', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns first match across all workspaces', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-4',
          workspace_id: 'ws-any',
          email: 'global@user.com',
          display_name: 'Global',
          role: 'editor',
          created_at: '2026-01-01T00:00:00Z',
          password_hash: 'hash456',
        },
      ],
    });

    const user = await findUserByEmail('global@user.com');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('global@user.com');
  });

  test('returns null for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const user = await findUserByEmail('unknown@nowhere.com');
    expect(user).toBeNull();
  });
});

// ─── listUsers ────────────────────────────────────────────────────

describe('listUsers', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns users for a workspace', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-a',
          workspace_id: 'ws-1',
          email: 'a@a.com',
          display_name: 'A',
          role: 'owner',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'u-b',
          workspace_id: 'ws-1',
          email: 'b@b.com',
          display_name: 'B',
          role: 'editor',
          created_at: '2026-01-02T00:00:00Z',
        },
      ],
    });

    const users = await listUsers('ws-1');
    expect(users).toHaveLength(2);
    expect(users[0]!.id).toBe('u-a');
    expect(users[1]!.id).toBe('u-b');
  });

  test('returns empty array for workspace with no users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const users = await listUsers('empty-ws');
    expect(users).toHaveLength(0);
  });
});

// ─── updateUserRole ───────────────────────────────────────────────

describe('updateUserRole', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('updates user role and returns updated user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'u-x',
          workspace_id: 'ws-1',
          email: 'x@x.com',
          display_name: 'X',
          role: 'maintainer',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const user = await updateUserRole('u-x', 'maintainer');
    expect(user).not.toBeNull();
    expect(user!.role).toBe('maintainer');
  });

  test('returns null when user not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const user = await updateUserRole('no-such-user', 'editor');
    expect(user).toBeNull();
  });

  // Verify valid role transitions
  test.each(['owner' as const, 'maintainer' as const, 'editor' as const, 'viewer' as const])(
    'accepts valid role: %s',
    async (role) => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'u-r',
            workspace_id: 'ws-1',
            email: 'r@r.com',
            display_name: 'R',
            role,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      });

      const user = await updateUserRole('u-r', role);
      expect(user!.role).toBe(role);
    },
  );
});

// ─── verifyServiceAccountToken ────────────────────────────────────

describe('verifyServiceAccountToken', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns service account for valid token', async () => {
    const rawToken = generateServiceToken();
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'sa-1',
          workspace_id: 'ws-1',
          name: 'CI Bot',
          token_hash: tokenHash,
          scopes: ['read:runs', 'create:runs'],
          expires_at: null,
          created_at: '2026-01-01T00:00:00Z',
          revoked_at: null,
        },
      ],
    });

    const sa = await verifyServiceAccountToken(rawToken);
    expect(sa).not.toBeNull();
    expect(sa!.name).toBe('CI Bot');
    expect(sa!.scopes).toEqual(['read:runs', 'create:runs']);
  });

  test('returns null for invalid token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const sa = await verifyServiceAccountToken('invalid-token');
    expect(sa).toBeNull();
  });

  test('token hash is deterministic', async () => {
    const rawToken = generateServiceToken();

    // Compute the hash the same way the service does
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'sa-hash',
          workspace_id: 'ws-1',
          name: 'Hash Test',
          token_hash: tokenHash,
          scopes: [],
          expires_at: null,
          created_at: '2026-01-01T00:00:00Z',
          revoked_at: null,
        },
      ],
    });

    const sa = await verifyServiceAccountToken(rawToken);
    expect(sa).not.toBeNull();
  });
});

// ─── createUser ─────────────────────────────────────────────────

describe('createUser', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('creates a user with default role viewer', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const user = await createUser('ws-1', 'new@user.com', 'password123');

    expect(user.email).toBe('new@user.com');
    expect(user.role).toBe('viewer');
    expect(user.displayName).toBe('new@user.com'); // defaults to email
    expect(user.id).toMatch(/^usr-/);
  });

  test('creates a user with specified role', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const user = await createUser('ws-1', 'admin@user.com', 'password123', 'Admin User', 'owner');

    expect(user.role).toBe('owner');
    expect(user.displayName).toBe('Admin User');
  });

  test('stores hashed password, not plaintext', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await createUser('ws-1', 'user@test.com', 'my-secret-pw');

    const callArgs = mockQuery.mock.calls[0] as [string, unknown[]];
    const storedPassword = callArgs[1][3] as string;

    // The stored value includes an algorithm version and a per-password salt.
    expect(storedPassword).not.toBe('my-secret-pw');
    expect(storedPassword).toMatch(/^scrypt-v1\$[A-Za-z0-9_-]+\$[0-9a-f]{128}$/);
  });

  test('uses a unique salt for users with the same password', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await createUser('ws-1', 'first@test.com', 'shared-password');
    await createUser('ws-1', 'second@test.com', 'shared-password');

    const firstHash = mockQuery.mock.calls[0]?.[1]?.[3];
    const secondHash = mockQuery.mock.calls[1]?.[1]?.[3];
    expect(firstHash).not.toBe(secondHash);
  });

  test('each user gets a unique ID', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const u1 = await createUser('ws-1', 'a@test.com', 'pw');
    const u2 = await createUser('ws-1', 'b@test.com', 'pw');

    expect(u1.id).not.toBe(u2.id);
  });
});

// ─── listWorkspaces ───────────────────────────────────────────────

describe('listWorkspaces', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns list of workspaces', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'ws-a',
          name: 'Alpha',
          description: 'First workspace',
          created_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-03T00:00:00Z',
        },
        {
          id: 'ws-b',
          name: 'Beta',
          description: '',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const workspaces = await listWorkspaces();
    expect(workspaces).toHaveLength(2);
    expect(workspaces[0]!.name).toBe('Alpha');
    expect(workspaces[1]!.name).toBe('Beta');
  });

  test('returns empty array when no workspaces exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const workspaces = await listWorkspaces();
    expect(workspaces).toHaveLength(0);
  });
});

// ─── getWorkspace ─────────────────────────────────────────────────

describe('getWorkspace', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns workspace when found', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'ws-x',
          name: 'My Workspace',
          description: 'A test workspace',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const ws = await getWorkspace('ws-x');
    expect(ws).not.toBeNull();
    expect(ws!.name).toBe('My Workspace');
    expect(ws!.description).toBe('A test workspace');
  });

  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const ws = await getWorkspace('missing');
    expect(ws).toBeNull();
  });
});

// ─── revokeServiceAccount ────────────────────────────────────────

describe('revokeServiceAccount', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('calls UPDATE with correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await revokeServiceAccount('sa-to-revoke');

    const callArgs = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(callArgs[1][0]).toBe('sa-to-revoke');
    // revoked_at should be set to now (a timestamp string)
    expect(callArgs[1][1]).toBeTruthy();
    expect(typeof callArgs[1][1]).toBe('string');
  });
});

// ─── listServiceAccounts ──────────────────────────────────────────

describe('listServiceAccounts', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns service accounts without token hashes', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'sa-list-1',
          workspace_id: 'ws-1',
          name: 'Bot 1',
          scopes: ['read:runs'],
          expires_at: null,
          created_at: '2026-01-01T00:00:00Z',
          revoked_at: null,
        },
        {
          id: 'sa-list-2',
          workspace_id: 'ws-1',
          name: 'Bot 2',
          scopes: [],
          expires_at: '2026-06-01T00:00:00Z',
          created_at: '2026-01-02T00:00:00Z',
          revoked_at: '2026-03-01T00:00:00Z',
        },
      ],
    });

    const accounts = await listServiceAccounts('ws-1');
    expect(accounts).toHaveLength(2);
    expect(accounts[0]!.name).toBe('Bot 1');
    expect(accounts[0]!.revokedAt).toBeNull();
    expect(accounts[1]!.revokedAt).toBe('2026-03-01T00:00:00Z');

    // Token hash should NOT be present
    expect(Object.keys(accounts[0]!)).not.toContain('tokenHash');
  });

  test('returns empty array for workspace with no accounts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const accounts = await listServiceAccounts('empty-ws');
    expect(accounts).toHaveLength(0);
  });
});
