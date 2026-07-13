import { createHash } from 'node:crypto';
import { pool } from '../../db/db.js';
import { getObjectStore, type ObjectStore } from '../../shared/object-storage.js';

interface StepEventRow {
  stepIndex: number;
  eventType: string;
  payload: unknown;
  payloadObjectKey?: string;
  timestamp: string;
}

/** Aggregate run summary with step event details. */
export async function getRunReport(runId: string, objectStore: ObjectStore = getObjectStore()) {
  const runResult = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (runResult.rows.length === 0) return null;

  const run = runResult.rows[0];

  const stepEventsResult = await pool.query(
    `SELECT step_index, event_type, payload_json, content_hash, payload_object_key, created_at
     FROM step_events
     WHERE run_id = $1
     ORDER BY step_index, created_at`,
    [runId],
  );

  // Group by step_index
  const stepsMap = new Map<number, StepEventRow[]>();
  const hydratedEvents = await Promise.all(
    stepEventsResult.rows.map(async (event) => {
      if (!event.payload_object_key) return event;
      const stored = await objectStore.get(event.payload_object_key);
      const raw = new TextDecoder().decode(stored.body);
      const hash = createHash('sha256').update(raw).digest('hex');
      if (hash !== event.content_hash) {
        throw new Error(`Evidence payload integrity check failed for ${event.payload_object_key}`);
      }
      return { ...event, payload_json: JSON.parse(raw) };
    }),
  );

  for (const evt of hydratedEvents) {
    const idx = evt.step_index;
    const stepEvents = stepsMap.get(idx) ?? [];
    if (!stepsMap.has(idx)) stepsMap.set(idx, stepEvents);
    stepEvents.push({
      stepIndex: idx,
      eventType: evt.event_type,
      payload: evt.payload_json,
      ...(evt.payload_object_key ? { payloadObjectKey: evt.payload_object_key } : {}),
      timestamp: evt.created_at,
    });
  }

  const steps = Array.from(stepsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([stepIndex, events]) => ({
      stepIndex,
      events,
      status: inferStepStatus(events),
      durationMs: inferStepDuration(events),
    }));

  return {
    run: {
      id: run.id,
      apiVersionId: run.api_version_id,
      workflowVersionId: run.workflow_version_id,
      testCaseVersionId: run.test_case_version_id,
      status: run.status,
      runnerId: run.runner_id,
      claimedAt: run.claimed_at,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    },
    steps,
  };
}

function inferStepStatus(events: StepEventRow[]): 'passed' | 'failed' | 'error' | 'unknown' {
  const lastStepFinished = events.filter((e) => e.eventType === 'step.finished').at(-1);
  if (lastStepFinished) {
    const payload = lastStepFinished.payload as Record<string, unknown>;
    return (payload?.['status'] as 'passed' | 'failed' | 'error') ?? 'unknown';
  }
  return 'unknown';
}

function inferStepDuration(events: StepEventRow[]): number | undefined {
  const finished = events.filter((e) => e.eventType === 'step.finished').at(-1);
  if (finished) {
    const payload = finished.payload as Record<string, unknown>;
    return payload?.['totalDurationMs'] as number | undefined;
  }
  return undefined;
}
