import type pg from 'pg';

export async function applyAiGenerationSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
    ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_status_check
      CHECK (status IN ('pending','running','completed','failed','cancelled'));
    ALTER TABLE generated_drafts ALTER COLUMN confidence DROP NOT NULL;
    CREATE TABLE ai_workers (
      worker_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      identity JSONB NOT NULL,
      heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE ai_generation_tasks (
      job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id),
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      task JSONB NOT NULL,
      input_hash TEXT NOT NULL,
      worker_id TEXT,
      lease_token TEXT,
      leased_until TIMESTAMPTZ,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error_code TEXT,
      result_hash TEXT
    );
    CREATE INDEX ai_generation_tasks_claim ON ai_generation_tasks(workspace_id, leased_until);
  `);
}
