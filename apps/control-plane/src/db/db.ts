import pg from 'pg';
import { applyAiGenerationSchema } from './migrations/002_ai_generation.js';
import { applyAiPlansSchema } from './migrations/003_ai_plans.js';
import { applyReliabilitySchema } from './migrations/004_reliability.js';
import { applyAgentsSchema } from './migrations/005_agents.js';

const { Pool } = pg;

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/sketchtest';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Idle client failures must not terminate the API; readiness probes report degradation.
// Never log the connection string or server error detail (which can contain credentials).
pool.on('error', () => {
  console.error('[database] Idle connection lost; pool will reconnect on the next request');
});

/**
 * Run all database migrations. Uses CREATE TABLE IF NOT EXISTS
 * so it's safe to run repeatedly — only new tables are created.
 *
 * Covers the complete product schema. Tables are grouped by domain below so
 * migration history does not leak obsolete delivery milestones into runtime.
 */
async function applyInitialPlatformSchema(client: pg.PoolClient): Promise<void> {
  // ── Core execution ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS api_versions (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL,
        source_type     TEXT NOT NULL,
        source_location TEXT NOT NULL,
        source_object_key TEXT,
        content_hash    TEXT NOT NULL,
        spec_json       JSONB NOT NULL,
        diagnostics     JSONB NOT NULL DEFAULT '[]',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS runs (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL,
        api_version_id  TEXT REFERENCES api_versions(id),
        workflow_version_id TEXT,
        test_case_version_id TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        plan_json       JSONB NOT NULL,
        runner_id       TEXT,
        claimed_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at     TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS step_events (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL REFERENCES runs(id),
        step_index      INTEGER NOT NULL,
        event_type      TEXT NOT NULL,
        payload_json    JSONB NOT NULL,
        content_hash    TEXT,
        payload_size_bytes BIGINT,
        payload_object_key TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS evidence_manifests (
        run_id          TEXT PRIMARY KEY REFERENCES runs(id),
        manifest_hash   TEXT NOT NULL,
        object_key      TEXT NOT NULL,
        event_count     INTEGER NOT NULL,
        total_size_bytes BIGINT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

    `);

  // Add provenance columns to databases created by earlier schema revisions.
  await client.query(`
      ALTER TABLE api_versions ADD COLUMN IF NOT EXISTS source_object_key TEXT;
      ALTER TABLE api_versions ADD COLUMN IF NOT EXISTS workspace_id TEXT;
      ALTER TABLE runs ADD COLUMN IF NOT EXISTS workflow_version_id TEXT;
      ALTER TABLE runs ADD COLUMN IF NOT EXISTS test_case_version_id TEXT;
      ALTER TABLE runs ADD COLUMN IF NOT EXISTS workspace_id TEXT;
      ALTER TABLE step_events ADD COLUMN IF NOT EXISTS content_hash TEXT;
      ALTER TABLE step_events ADD COLUMN IF NOT EXISTS payload_size_bytes BIGINT;
      ALTER TABLE step_events ADD COLUMN IF NOT EXISTS payload_object_key TEXT;
    `);

  // ── IAM ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL UNIQUE,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        email           TEXT NOT NULL,
        password_hash   TEXT NOT NULL,
        display_name    TEXT NOT NULL DEFAULT '',
        role            TEXT NOT NULL DEFAULT 'viewer'
          CHECK (role IN ('owner','maintainer','editor','viewer')),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(workspace_id, email)
      );

      CREATE TABLE IF NOT EXISTS service_accounts (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        token_hash      TEXT NOT NULL,
        scopes          JSONB NOT NULL DEFAULT '[]',
        expires_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at      TIMESTAMPTZ
      );

      DO $$
      DECLARE
        workspace_count INTEGER;
        only_workspace_id TEXT;
      BEGIN
        SELECT COUNT(*), MIN(id) INTO workspace_count, only_workspace_id FROM workspaces;

        IF EXISTS (SELECT 1 FROM api_versions WHERE workspace_id IS NULL) THEN
          IF workspace_count = 1 THEN
            UPDATE api_versions SET workspace_id = only_workspace_id WHERE workspace_id IS NULL;
          ELSE
            RAISE EXCEPTION
              'Cannot migrate api_versions without workspace ownership: expected one workspace, found %',
              workspace_count;
          END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM runs WHERE workspace_id IS NULL) THEN
          IF workspace_count = 1 THEN
            UPDATE runs SET workspace_id = only_workspace_id WHERE workspace_id IS NULL;
          ELSE
            RAISE EXCEPTION
              'Cannot migrate runs without workspace ownership: expected one workspace, found %',
              workspace_count;
          END IF;
        END IF;
      END $$;

      ALTER TABLE api_versions ALTER COLUMN workspace_id SET NOT NULL;
      ALTER TABLE runs ALTER COLUMN workspace_id SET NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'api_versions_workspace_id_fkey'
        ) THEN
          ALTER TABLE api_versions
            ADD CONSTRAINT api_versions_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'runs_workspace_id_fkey'
        ) THEN
          ALTER TABLE runs
            ADD CONSTRAINT runs_workspace_id_fkey
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS idx_api_versions_workspace_created
        ON api_versions(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_workspace_created
        ON runs(workspace_id, created_at DESC);
    `);

  await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT REFERENCES workspaces(id),
        actor_type      TEXT NOT NULL,
        actor_id        TEXT NOT NULL,
        action          TEXT NOT NULL,
        resource_type   TEXT NOT NULL,
        resource_id     TEXT NOT NULL,
        outcome         TEXT NOT NULL,
        request_id      TEXT,
        metadata        JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created
        ON audit_logs(workspace_id, created_at DESC);
    `);

  // ── Environment & Secret ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS environments (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS environment_versions (
        id              TEXT PRIMARY KEY,
        environment_id  TEXT NOT NULL REFERENCES environments(id),
        version         INTEGER NOT NULL,
        base_url        TEXT NOT NULL DEFAULT '',
        variables       JSONB NOT NULL DEFAULT '{}',
        runner_labels   JSONB NOT NULL DEFAULT '[]',
        require_approval BOOLEAN NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(environment_id, version)
      );

      CREATE TABLE IF NOT EXISTS secrets (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(workspace_id, name)
      );
    `);

  // ── Test Cases ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS test_cases (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        api_version_id  TEXT REFERENCES api_versions(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS test_case_versions (
        id              TEXT PRIMARY KEY,
        test_case_id    TEXT NOT NULL REFERENCES test_cases(id),
        version         INTEGER NOT NULL,
        definition      JSONB NOT NULL,
        side_effect     TEXT NOT NULL DEFAULT 'read-only'
          CHECK (side_effect IN ('read-only','cleanup-required','irreversible','high-risk')),
        published_by    TEXT,
        published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(test_case_id, version)
      );
    `);

  // ── Generation ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS generation_jobs (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        api_version_id  TEXT NOT NULL REFERENCES api_versions(id),
        strategy        TEXT NOT NULL DEFAULT 'schema',
        status          TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','running','completed','failed')),
        config          JSONB DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at    TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS generated_drafts (
        id              TEXT PRIMARY KEY,
        job_id          TEXT NOT NULL REFERENCES generation_jobs(id),
        test_case_id    TEXT REFERENCES test_cases(id),
        definition      JSONB NOT NULL,
        source_info     JSONB NOT NULL DEFAULT '{}',
        confidence      REAL NOT NULL DEFAULT 0.5,
        status          TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','accepted','rejected','modified')),
        reviewed_by     TEXT,
        reviewed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

  // ── Runner Registry ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS runners (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        version         TEXT NOT NULL DEFAULT '0.1.0',
        labels          JSONB NOT NULL DEFAULT '[]',
        status          TEXT NOT NULL DEFAULT 'offline'
          CHECK (status IN ('online','offline','draining')),
        last_heartbeat  TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS runner_heartbeats (
        id              SERIAL PRIMARY KEY,
        runner_id       TEXT NOT NULL REFERENCES runners(id),
        capacity        JSONB DEFAULT '{}',
        recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS runner_tokens (
        token_hash      TEXT PRIMARY KEY,
        runner_id       TEXT NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
        workspace_id    TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

  // ── Workflows ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS workflow_versions (
        id              TEXT PRIMARY KEY,
        workflow_id     TEXT NOT NULL REFERENCES workflows(id),
        version         INTEGER NOT NULL,
        definition      JSONB NOT NULL,
        compiled_plan   JSONB,
        published_by    TEXT,
        published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(workflow_id, version)
      );
    `);

  // ── Datasets ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS datasets (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS dataset_versions (
        id              TEXT PRIMARY KEY,
        dataset_id      TEXT NOT NULL REFERENCES datasets(id),
        version         INTEGER NOT NULL,
        rows_json       JSONB NOT NULL DEFAULT '[]',
        sensitive_fields JSONB NOT NULL DEFAULT '[]',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(dataset_id, version)
      );
    `);

  // ── Test Suites & Quality Gates ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS test_suites (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS test_suite_versions (
        id              TEXT PRIMARY KEY,
        test_suite_id   TEXT NOT NULL REFERENCES test_suites(id),
        version         INTEGER NOT NULL,
        members_json    JSONB NOT NULL DEFAULT '[]',
        quality_gate_json JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(test_suite_id, version)
      );

      CREATE TABLE IF NOT EXISTS schedule_configs (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        test_suite_id   TEXT NOT NULL REFERENCES test_suites(id),
        cron_expression TEXT NOT NULL,
        environment_id  TEXT REFERENCES environments(id),
        enabled         BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

  // ── Policies ──
  await client.query(`
      CREATE TABLE IF NOT EXISTS policies (
        id              TEXT PRIMARY KEY,
        workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
        name            TEXT NOT NULL,
        description     TEXT DEFAULT '',
        rules_json      JSONB NOT NULL DEFAULT '[]',
        priority        INTEGER NOT NULL DEFAULT 0,
        enabled         BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

  // ── Indexes ──
  await client.query(`
      CREATE INDEX IF NOT EXISTS idx_step_events_run ON step_events(run_id, step_index);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_versions_created ON api_versions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_environments_workspace ON environments(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_test_cases_workspace ON test_cases(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_test_case_versions_case ON test_case_versions(test_case_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_workflows_workspace ON workflows(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_versions_wf ON workflow_versions(workflow_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_runners_workspace ON runners(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_runner_heartbeats_runner ON runner_heartbeats(runner_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_generated_drafts_job ON generated_drafts(job_id);
      CREATE INDEX IF NOT EXISTS idx_secrets_workspace ON secrets(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_policies_workspace ON policies(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_configs_ws ON schedule_configs(workspace_id);
    `);
}

interface Migration {
  version: number;
  name: string;
  checksum: string;
  up: (client: pg.PoolClient) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-platform-schema',
    checksum: 'initial-platform-schema-v1',
    up: applyInitialPlatformSchema,
  },
  { version: 2, name: 'ai-generation', checksum: 'ai-generation-v1', up: applyAiGenerationSchema },
  { version: 3, name: 'ai-plans', checksum: 'ai-plans-v1', up: applyAiPlansSchema },
  { version: 4, name: 'reliability', checksum: 'reliability-v1', up: applyReliabilitySchema },
  { version: 5, name: 'agents', checksum: 'agents-v1', up: applyAgentsSchema },
];

/** Apply each immutable schema migration once, under a PostgreSQL advisory lock. */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('sketchtest-schema-migrations'))`);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version       INTEGER PRIMARY KEY,
        name          TEXT NOT NULL UNIQUE,
        checksum      TEXT NOT NULL,
        applied_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query(
      `SELECT version, name, checksum FROM schema_migrations ORDER BY version`,
    );
    const applied = new Map<number, { name: string; checksum: string }>(
      appliedResult.rows.map((row) => [
        row.version as number,
        { name: row.name as string, checksum: row.checksum as string },
      ]),
    );

    for (const migration of MIGRATIONS) {
      const recorded = applied.get(migration.version);
      if (recorded) {
        if (recorded.name !== migration.name || recorded.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.version} does not match the immutable applied record`,
          );
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await migration.up(client);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`[db] Database schema is current at version ${MIGRATIONS.at(-1)?.version ?? 0}`);
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock(hashtext('sketchtest-schema-migrations'))`);
    }
    client.release();
  }
}

/**
 * Check database connectivity.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
