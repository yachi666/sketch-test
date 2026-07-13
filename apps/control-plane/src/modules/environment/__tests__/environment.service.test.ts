/**
 * Environment service unit tests.
 *
 * Tests encryption/decryption utilities and CRUD operations (with mocked DB).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

// ─── Mock pool ─────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClient = {
  query: (...args: unknown[]) => mockClientQuery(...args),
  release: vi.fn(),
};

vi.mock('../../../db/db.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => Promise.resolve(mockClient),
  },
}));

vi.mock('../../../shared/id.js', () => ({
  environmentId: () => `env-${Math.random().toString(36).slice(2, 10)}`,
  environmentVersionId: () => `envv-${Math.random().toString(36).slice(2, 10)}`,
  secretId: () => `sec-${Math.random().toString(36).slice(2, 10)}`,
}));

import {
  createEnvironment,
  createEnvironmentVersion,
  createSecret,
  decryptSecret,
  deleteEnvironment,
  deleteSecret,
  getEnvironment,
  getEnvironmentVersion,
  getSecret,
  listEnvironments,
  listEnvironmentVersions,
  listSecrets,
  updateEnvironment,
  updateSecret,
} from '../environment.service';

// ─── Helpers ───────────────────────────────────────────────────────

function makeEnvRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'env-001',
    workspace_id: 'ws-001',
    name: 'Production',
    description: 'Prod environment',
    created_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeEnvVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'envv-001',
    environment_id: 'env-001',
    version: 1,
    base_url: 'https://api.example.com',
    variables: { host: 'api.example.com', port: '443' },
    runner_labels: ['default'],
    require_approval: false,
    created_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

function makeSecretRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sec-001',
    workspace_id: 'ws-001',
    name: 'API_KEY',
    encrypted_value: 'abcdef:0123456789abcdef:encrypted-data-here',
    description: 'API key for external service',
    created_at: '2026-06-24T10:00:00Z',
    updated_at: '2026-06-24T10:00:00Z',
    ...overrides,
  };
}

// ─── Tests: Environment CRUD ───────────────────────────────────────

describe('createEnvironment', () => {
  afterEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
  });

  test('creates an environment and initial version in transaction', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // INSERT environment
      .mockResolvedValueOnce({ rows: [] }) // INSERT version
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    mockQuery.mockResolvedValueOnce({ rows: [makeEnvRow()] }); // SELECT after commit

    const env = await createEnvironment('ws-001', 'Production');
    expect(env.name).toBe('Production');
    expect(env.workspaceId).toBe('ws-001');
  });
});

describe('getEnvironment', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns environment by ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeEnvRow({ name: 'Staging' })] });

    const env = await getEnvironment('env-001');
    expect(env).not.toBeNull();
    expect(env!.name).toBe('Staging');
  });

  test('returns null for non-existent environment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const env = await getEnvironment('non-existent');
    expect(env).toBeNull();
  });
});

describe('listEnvironments', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns environments for a workspace', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeEnvRow({ id: 'env-1', name: 'Prod' }),
        makeEnvRow({ id: 'env-2', name: 'Staging' }),
      ],
    });

    const envs = await listEnvironments('ws-001');
    expect(envs).toHaveLength(2);
  });

  test('returns empty array for workspace with no environments', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const envs = await listEnvironments('ws-empty');
    expect(envs).toEqual([]);
  });
});

describe('updateEnvironment', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates environment name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeEnvRow({ name: 'Updated Prod' })],
    });

    const env = await updateEnvironment('env-001', 'Updated Prod');
    expect(env).not.toBeNull();
    expect(env!.name).toBe('Updated Prod');
  });

  test('returns null for non-existent environment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const env = await updateEnvironment('non-existent', 'New');
    expect(env).toBeNull();
  });

  test('returns current state when no fields provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeEnvRow()] });

    const env = await updateEnvironment('env-001');
    expect(env!.name).toBe('Production');
  });
});

describe('deleteEnvironment', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes environment when no schedules reference it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // schedule check
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

    const deleted = await deleteEnvironment('env-001');
    expect(deleted).toBe(true);
  });

  test('throws when scheduled runs reference the environment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // schedule check

    await expect(deleteEnvironment('env-001')).rejects.toThrow('schedules');
  });

  test('returns false when environment does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const deleted = await deleteEnvironment('non-existent');
    expect(deleted).toBe(false);
  });
});

// ─── Tests: Environment Version ────────────────────────────────────

describe('createEnvironmentVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates a new version with auto-increment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ next_version: '3' }] }); // max version
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT version
    mockQuery.mockResolvedValueOnce({ rows: [makeEnvVersionRow({ version: 3 })] }); // SELECT

    const version = await createEnvironmentVersion('env-001', 'https://api.example.com', {
      host: 'api.example.com',
    });
    expect(version.version).toBe(3);
  });

  test('resolves secret refs in returned variables', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ next_version: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeEnvVersionRow({
          version: 1,
          variables: { host: 'example.com', apiKey: '${secret.API_KEY}' },
        }),
      ],
    });

    const version = await createEnvironmentVersion('env-001', 'https://api.example.com', {
      host: 'example.com',
      apiKey: '${secret.API_KEY}',
    });

    expect(version.variables['host']).toBe('example.com');
    expect(version.variables['apiKey']).toBe('***SECRET***');
  });
});

describe('getEnvironmentVersion', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns a version by ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeEnvVersionRow()] });

    const version = await getEnvironmentVersion('envv-001');
    expect(version).not.toBeNull();
    expect(version!.version).toBe(1);
  });

  test('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const version = await getEnvironmentVersion('non-existent');
    expect(version).toBeNull();
  });
});

describe('listEnvironmentVersions', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns versions in descending order', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        makeEnvVersionRow({ version: 3 }),
        makeEnvVersionRow({ version: 2 }),
        makeEnvVersionRow({ version: 1 }),
      ],
    });

    const versions = await listEnvironmentVersions('env-001');
    expect(versions).toHaveLength(3);
    expect(versions[0]!.version).toBe(3);
  });
});

// ─── Tests: Secrets ────────────────────────────────────────────────

describe('createSecret', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('creates an encrypted secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [makeSecretRow()] }); // SELECT

    const secret = await createSecret(
      'ws-001',
      'API_KEY',
      'my-secret-value',
      'API key description',
    );
    expect(secret.name).toBe('API_KEY');
    expect(secret.workspaceId).toBe('ws-001');
    // Value should be encrypted (not plaintext in response)
    expect(secret).not.toHaveProperty('plaintextValue');
  });
});

describe('getSecret', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeSecretRow()] });

    const secret = await getSecret('sec-001');
    expect(secret).not.toBeNull();
    expect(secret!.name).toBe('API_KEY');
  });
});

describe('listSecrets', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('returns secrets for a workspace', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSecretRow({ name: 'A' }), makeSecretRow({ name: 'B' })],
    });

    const secrets = await listSecrets('ws-001');
    expect(secrets).toHaveLength(2);
  });
});

describe('updateSecret', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('updates secret value (re-encrypts)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSecretRow({ name: 'API_KEY', updated_at: '2026-06-24T11:00:00Z' })],
    });

    const secret = await updateSecret('sec-001', 'new-secret');
    expect(secret).not.toBeNull();
  });

  test('updates secret value and description', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeSecretRow({ description: 'New desc' })],
    });

    const secret = await updateSecret('sec-001', 'new-secret', 'New desc');
    expect(secret!.description).toBe('New desc');
  });

  test('returns null when secret not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const secret = await updateSecret('non-existent', 'value');
    expect(secret).toBeNull();
  });
});

describe('deleteSecret', () => {
  afterEach(() => {
    mockQuery.mockReset();
  });

  test('deletes a secret', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const deleted = await deleteSecret('sec-001');
    expect(deleted).toBe(true);
  });

  test('returns false when secret not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const deleted = await deleteSecret('non-existent');
    expect(deleted).toBe(false);
  });
});

// ─── Tests: Encryption ─────────────────────────────────────────────

describe('decryptSecret', () => {
  test('throws on invalid encrypted value format', () => {
    expect(() => decryptSecret('bad-format')).toThrow('Invalid encrypted value format');
  });

  test('throws on wrong number of colon-separated parts', () => {
    expect(() => decryptSecret('a:b')).toThrow('Invalid encrypted value format');
    expect(() => decryptSecret('a:b:c:d')).toThrow('Invalid encrypted value format');
  });
});
