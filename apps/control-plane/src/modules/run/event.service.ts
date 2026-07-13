import { createHash } from 'node:crypto';
import { pool } from '../../db/db.js';
import { eventId } from '../../shared/id.js';
import { getObjectStore, type ObjectStore } from '../../shared/object-storage.js';

export interface IncomingEvent {
  id?: string;
  runId: string;
  stepIndex: number;
  eventType: string;
  payload: unknown;
}

const DEFAULT_INLINE_MAX_BYTES = 64 * 1024;

function inlineMaxBytes(): number {
  const configured = Number.parseInt(process.env['EVIDENCE_INLINE_MAX_BYTES'] ?? '', 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_INLINE_MAX_BYTES;
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
  objectStore: ObjectStore = getObjectStore(),
  maxInlineBytes = inlineMaxBytes(),
): Promise<{ accepted: number; duplicates: number; contentHashes: string[] }> {
  let accepted = 0;
  let duplicates = 0;
  const contentHashes: string[] = [];

  for (const evt of events) {
    const id = evt.id ?? eventId();
    const payloadStr = JSON.stringify(evt.payload);
    const contentHash = createHash('sha256').update(payloadStr).digest('hex');
    const payloadSizeBytes = Buffer.byteLength(payloadStr);
    const payloadObjectKey =
      payloadSizeBytes > maxInlineBytes ? `runs/${runId}/events/${id}/${contentHash}.json` : null;
    if (payloadObjectKey) {
      await objectStore.put(payloadObjectKey, payloadStr, 'application/json');
    }
    const storedPayload = payloadObjectKey
      ? JSON.stringify({
          externalized: true,
          objectKey: payloadObjectKey,
          contentHash,
          sizeBytes: payloadSizeBytes,
        })
      : payloadStr;

    const result = await pool.query(
      `INSERT INTO step_events
         (id, run_id, step_index, event_type, payload_json, content_hash, payload_size_bytes, payload_object_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
      [
        id,
        runId,
        evt.stepIndex,
        evt.eventType,
        storedPayload,
        contentHash,
        payloadSizeBytes,
        payloadObjectKey,
      ],
    );
    if ((result.rowCount ?? 0) > 0) {
      accepted++;
      contentHashes.push(contentHash);
    } else {
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
    `SELECT id, step_index, event_type, payload_json, content_hash,
            payload_size_bytes, payload_object_key, created_at
     FROM step_events
     WHERE run_id = $1
     ORDER BY step_index, created_at`,
    [runId],
  );

  const events = result.rows.map((row) => {
    const legacyPayload =
      typeof row.payload_json === 'string' ? row.payload_json : JSON.stringify(row.payload_json);
    return {
      id: row.id,
      stepIndex: row.step_index,
      eventType: row.event_type,
      contentHash: row.content_hash ?? createHash('sha256').update(legacyPayload).digest('hex'),
      sizeBytes: Number(row.payload_size_bytes ?? Buffer.byteLength(legacyPayload)),
      ...(row.payload_object_key ? { objectKey: row.payload_object_key as string } : {}),
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

/** Persist a content-addressed, immutable evidence manifest and its lookup metadata. */
export async function persistEvidenceManifest(
  runId: string,
  objectStore: ObjectStore = getObjectStore(),
) {
  const manifest = await buildEvidenceManifest(runId);
  const body = JSON.stringify(manifest);
  const objectKey = `runs/${runId}/manifests/${manifest.manifestHash}.json`;
  await objectStore.put(objectKey, body, 'application/json');
  await pool.query(
    `INSERT INTO evidence_manifests
       (run_id, manifest_hash, object_key, event_count, total_size_bytes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (run_id) DO NOTHING`,
    [runId, manifest.manifestHash, objectKey, manifest.eventCount, manifest.totalSizeBytes],
  );
  return { ...manifest, objectKey };
}

export async function getPersistedEvidenceManifest(
  runId: string,
  objectStore: ObjectStore = getObjectStore(),
) {
  const result = await pool.query(
    `SELECT manifest_hash, object_key, event_count, total_size_bytes
     FROM evidence_manifests WHERE run_id = $1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const stored = await objectStore.get(row.object_key as string);
  const manifest = JSON.parse(new TextDecoder().decode(stored.body)) as Awaited<
    ReturnType<typeof buildEvidenceManifest>
  >;
  const computedHash = createHash('sha256')
    .update(manifest.events.map((event) => event.contentHash).join(''))
    .digest('hex');
  if (
    manifest.runId !== runId ||
    manifest.manifestHash !== row.manifest_hash ||
    computedHash !== row.manifest_hash
  ) {
    throw new Error(`Evidence manifest integrity check failed for run ${runId}`);
  }
  return { ...manifest, objectKey: row.object_key as string };
}

/**
 * Verify the integrity of a run's evidence by re-computing all content hashes
 * and comparing against the stored manifest.
 */
export async function verifyEvidenceIntegrity(
  runId: string,
  objectStore: ObjectStore = getObjectStore(),
) {
  const manifest = await buildEvidenceManifest(runId);
  // Re-compute the chain hash from stored events
  const result = await pool.query(
    `SELECT id, payload_json, content_hash, payload_object_key
     FROM step_events WHERE run_id = $1 ORDER BY step_index, created_at`,
    [runId],
  );

  const hashes = await Promise.all(
    result.rows.map(async (row) => {
      const payloadStr = row.payload_object_key
        ? new TextDecoder().decode((await objectStore.get(row.payload_object_key)).body)
        : typeof row.payload_json === 'string'
          ? row.payload_json
          : JSON.stringify(row.payload_json);
      return { id: row.id, hash: createHash('sha256').update(payloadStr).digest('hex') };
    }),
  );

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
