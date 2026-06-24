import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/sketchtest';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/**
 * Run all database migrations. Uses CREATE TABLE IF NOT EXISTS
 * so it's safe to run repeatedly — only new tables are created.
 *
 * Covers M0 through M2 schemas:
 * - M0: api_versions, runs, step_events
 * - M1: workspaces, users, memberships, service_accounts, environments,
 *        environment_versions, secrets, test_cases, test_case_versions,
 *        generation_jobs, generated_drafts, runners, runner_heartbeats
 * - M2: workflows, workflow_versions, datasets, dataset_versions,
 *        test_suites, test_suite_versions, test_suite_members,
 *        quality_gates, policies, schedule_configs
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── M0: Core execution ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_versions (
        id              TEXT PRIMARY KEY,
        source_type     TEXT NOT NULL,
        source_location TEXT NOT NULL,
        content_hash    TEXT NOT NULL,
        spec_json       JSONB NOT NULL,
        diagnostics     JSONB NOT NULL DEFAULT '[]',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS runs (
        id              TEXT PRIMARY KEY,
        api_version_id  TEXT REFERENCES api_versions(id),
        workflow_version_id TEXT,
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
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // ── M1: IAM ──
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
    `);

    // ── M1: Environment & Secret ──
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

    // ── M1: Test Cases ──
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

    // ── M1: Generation ──
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

    // ── M1: Runner Registry ──
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

    // ── M2: Workflows ──
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

    // ── M2: Datasets ──
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

    // ── M2: Test Suites & Quality Gates ──
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

    // ── M2: Policies ──
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

    console.log('[db] All migrations applied successfully (M0–M2 schema)');
  } finally {
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
