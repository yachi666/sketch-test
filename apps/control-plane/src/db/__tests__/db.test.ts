import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  const connect = vi.fn().mockResolvedValue({ query, release });
  return { query, release, connect };
});

vi.mock('pg', () => ({
  default: {
    Pool: class {
      connect = mocks.connect;
      query = mocks.query;
    },
  },
}));

import { runMigrations } from '../db.js';

describe('runMigrations', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockClear();
  });

  test('applies and records an unapplied migration in one transaction', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT version, name, checksum')) return { rows: [] };
      return { rows: [] };
    });

    await runMigrations();

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toContain('BEGIN');
    expect(
      sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS api_versions')),
    ).toBe(true);
    expect(sql.some((statement) => statement.includes('INSERT INTO schema_migrations'))).toBe(true);
    expect(sql).toContain('COMMIT');
    expect(sql.at(-1)).toContain('pg_advisory_unlock');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  test('does not reapply a migration already recorded with the same identity', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT version, name, checksum')) {
        return {
          rows: [
            {
              version: 1,
              name: 'initial-platform-schema',
              checksum: 'initial-platform-schema-v1',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await runMigrations();

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement));
    expect(sql).not.toContain('BEGIN');
    expect(
      sql.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS api_versions')),
    ).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  test('fails closed when an applied migration identity has changed', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT version, name, checksum')) {
        return {
          rows: [{ version: 1, name: 'changed', checksum: 'changed' }],
        };
      }
      return { rows: [] };
    });

    await expect(runMigrations()).rejects.toThrow(/immutable applied record/);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toContain('pg_advisory_unlock');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  test('rolls back an unapplied migration when a schema statement fails', async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT version, name, checksum')) return { rows: [] };
      if (sql.includes('CREATE TABLE IF NOT EXISTS api_versions')) {
        throw new Error('schema failure');
      }
      return { rows: [] };
    });

    await expect(runMigrations()).rejects.toThrow('schema failure');

    const sql = mocks.query.mock.calls.map(([statement]) => String(statement));
    expect(sql).toContain('BEGIN');
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(sql.at(-1)).toContain('pg_advisory_unlock');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
