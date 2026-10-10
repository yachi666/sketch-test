import type pg from 'pg';
export async function applyAiPlansSchema(client: pg.PoolClient) {
  await client.query(`
    CREATE TABLE ai_plan_settings (workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),enabled BOOLEAN NOT NULL DEFAULT false,last_hash TEXT,last_checked TIMESTAMPTZ);
    CREATE TABLE ai_plan_jobs (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      task JSONB NOT NULL,input_hash TEXT NOT NULL,trigger TEXT NOT NULL,
      parent_id TEXT REFERENCES ai_plan_jobs(id),status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','completed','failed','cancelled')),
      proposal JSONB,saved_at TIMESTAMPTZ,revision INTEGER NOT NULL DEFAULT 0,
      suite_id TEXT REFERENCES test_suites(id) ON DELETE SET NULL,
      worker_id TEXT,lease_token TEXT,leased_until TIMESTAMPTZ,attempt INTEGER NOT NULL DEFAULT 0,
      result_hash TEXT,error_code TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ai_plan_jobs_queue ON ai_plan_jobs(workspace_id,status,created_at);
  `);
}
