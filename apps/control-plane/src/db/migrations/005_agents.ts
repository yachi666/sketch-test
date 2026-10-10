import type pg from 'pg';
/** Additive immutable Agent versions, original generation output and execution events. */
export async function applyAgentsSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE ai_plan_settings ADD COLUMN agent_id TEXT;
    ALTER TABLE ai_plan_jobs ADD COLUMN original_proposal JSONB;
    ALTER TABLE ai_plan_jobs ADD COLUMN execution_events JSONB;
    CREATE TABLE agent_connections (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      name TEXT NOT NULL, provider TEXT NOT NULL, connection_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(workspace_id, provider, connection_ref)
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE agent_versions (
      agent_id TEXT NOT NULL REFERENCES agents(id), version INTEGER NOT NULL,
      config JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(agent_id, version)
    );
    CREATE TABLE generation_events (
      id BIGSERIAL PRIMARY KEY, job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      attempt INTEGER NOT NULL, type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX generation_events_job ON generation_events(job_id, id);
    ALTER TABLE generated_drafts ADD COLUMN original_definition JSONB;
    CREATE INDEX generated_drafts_case ON generated_drafts(test_case_id);
    CREATE FUNCTION protect_agent_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Agent versions are immutable'; END;
    $$;
    CREATE TRIGGER agent_version_immutable BEFORE UPDATE OR DELETE ON agent_versions
      FOR EACH ROW EXECUTE FUNCTION protect_agent_version();
  `);
}
