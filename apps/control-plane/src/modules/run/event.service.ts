import { createHash } from 'node:crypto';
import { pool } from '../../db/db.js';
import { eventId } from '../../shared/id.js';

export interface IncomingEvent {
  id?: string;
  runId: string;
  stepIndex: number;
  eventType: string;
  payload: unknown;
}

/**
 * Idempotently insert step events with content hashing for evidence integrity.
 * Events with the same id are skipped (ON CONFLICT DO NOTHING).
 *
 * Each event gets a SHA-256 content hash computed from its payload,
 * enabling later verification that evidence hasn't been tampered with.
 *
 * Returns counts of accepted and duplicate events.
 */
export async function insertEvents(
  runId: string,
  events: IncomingEvent[],
): Promise<{ accepted: number; duplicates: number; contentHashes: string[] }> {
  let accepted = 0;
  let duplicates = 0;
  const contentHashes: string[] = [];

  for (const evt of events) {
    const id = evt.id ?? eventId();
    const payloadStr = JSON.stringify(evt.payload);
    const contentHash = createHash('sha256').update(payloadStr).digest('hex');

    try {
      const result = await pool.query(
        `INSERT INTO step_events (id, run_id, step_index, event_type, payload_json)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [id, runId, evt.stepIndex, evt.eventType, payloadStr],
      );
      if ((result.rowCount ?? 0) > 0) {
        accepted++;
        contentHashes.push(contentHash);
      } else {
        duplicates++;
      }
    } catch {
      duplicates++;
    }
  }

  return { accepted, duplicates, contentHashes };
}

/**
 * Compute the evidence manifest for a completed run.
 * The manifest includes content hashes for all events, enabling
 * verification that the evidence chain is intact.
 */
export async function buildEvidenceManifest(runId: string) {
  const result = await pool.query(
    `SELECT id, step_index, event_type, payload_json, created_at
     FROM step_events
     WHERE run_id = $1
     ORDER BY step_index, created_at`,
    [runId],
  );

  const events = result.rows.map((row) => {
    const payloadStr =
      typeof row.payload_json === 'string' ? row.payload_json : JSON.stringify(row.payload_json);
    return {
      id: row.id,
      stepIndex: row.step_index,
      eventType: row.event_type,
      contentHash: createHash('sha256').update(payloadStr).digest('hex'),
      sizeBytes: new TextEncoder().encode(payloadStr).length,
      createdAt: row.created_at,
    };
  });

  const totalSizeBytes = events.reduce((sum, e) => sum + e.sizeBytes, 0);
  const manifestHash = createHash('sha256')
    .update(events.map((e) => e.contentHash).join(''))
    .digest('hex');

  return {
    runId,
    eventCount: events.length,
    totalSizeBytes,
    manifestHash,
    events,
  };
}

/**
 * Verify the integrity of a run's evidence by re-computing all content hashes
 * and comparing against the stored manifest.
 */
export async function verifyEvidenceIntegrity(runId: string) {
  const manifest = await buildEvidenceManifest(runId);
  // Re-compute the chain hash from stored events
  const result = await pool.query(
    `SELECT id, payload_json FROM step_events WHERE run_id = $1 ORDER BY step_index, created_at`,
    [runId],
  );

  const hashes = result.rows.map((row) => {
    const payloadStr =
      typeof row.payload_json === 'string' ? row.payload_json : JSON.stringify(row.payload_json);
    return { id: row.id, hash: createHash('sha256').update(payloadStr).digest('hex') };
  });

  const reManifestHash = createHash('sha256')
    .update(hashes.map((h) => h.hash).join(''))
    .digest('hex');

  return {
    valid: reManifestHash === manifest.manifestHash,
    storedHash: manifest.manifestHash,
    computedHash: reManifestHash,
    eventCount: hashes.length,
  };
}
