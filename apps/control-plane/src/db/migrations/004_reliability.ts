import type pg from 'pg';

/** Additive migration: never rewrite historical hashes, manifests or published versions. */
export async function applyReliabilitySchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE step_events ADD COLUMN IF NOT EXISTS hash_encoding TEXT;
    CREATE TABLE IF NOT EXISTS schedule_dispatches (
      schedule_id TEXT NOT NULL REFERENCES schedule_configs(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMPTZ NOT NULL,
      run_ids JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (schedule_id, scheduled_at)
    );
  `);
}
