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
  const runResult = await pool.query(
    `SELECT r.*, wv.definition AS workflow_definition,
      COALESCE(wv.definition->>'name', tv.definition->>'name', '临时请求') AS source_name
     FROM runs r
     LEFT JOIN workflow_versions wv ON wv.id = r.workflow_version_id
     LEFT JOIN test_case_versions tv ON tv.id = r.test_case_version_id
     WHERE r.id = $1`,
    [runId],
  );
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

  const mainSteps = (run.plan_json?.steps ?? []) as Array<{ stepId: string; method: string }>;
  const plannedSteps = [...mainSteps, ...(run.plan_json?.teardown?.steps ?? [])] as Array<{
    stepId: string;
    method: string;
  }>;
  const stepIndexes = new Map(plannedSteps.map((step, index) => [step.stepId, index]));
  const runEvents: StepEventRow[] = [];
  for (const evt of hydratedEvents) {
    const payloadStepId = object(evt.payload_json)['stepId'];
    const idx =
      typeof payloadStepId === 'string'
        ? (stepIndexes.get(payloadStepId) ?? evt.step_index)
        : evt.step_index;
    if (idx < 0 || evt.event_type.startsWith('run.') || evt.event_type === 'teardown.started') {
      runEvents.push({
        stepIndex: idx,
        eventType: evt.event_type,
        payload: evt.payload_json,
        timestamp: evt.created_at,
      });
      continue;
    }
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

  // Frozen plans also retain steps with no evidence after a stop-on-failure.
  const cleanup = run.workflow_definition?.teardown;
  const definitions = [
    ...(run.workflow_definition?.steps ?? []),
    ...(Array.isArray(cleanup) ? cleanup : (cleanup?.steps ?? [])),
  ] as Array<{ id: string; name: string }>;
  for (let i = 0; i < plannedSteps.length; i++) {
    if (!stepsMap.has(i)) stepsMap.set(i, []);
  }
  const steps = Array.from(stepsMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([stepIndex, events]) => {
      // Runner sequence is authoritative even when uploads arrive out of order.
      events.sort((a, b) => {
        const left = object(a.payload)['sequence'];
        const right = object(b.payload)['sequence'];
        return typeof left === 'number' && typeof right === 'number'
          ? left - right
          : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
      const planStep = plannedSteps[stepIndex];
      const prepared = object(
        events.find((event) => event.eventType === 'request.prepared')?.payload,
      );
      const finished = object(
        events.filter((event) => event.eventType === 'step.finished').at(-1)?.payload,
      );
      const assertions = events
        .filter((event) => ['assertion.evaluated', 'assertion.ran'].includes(event.eventType))
        .map((event) => {
          const p = object(event.payload);
          return {
            assertionId: p['assertionId'],
            description: p['description'],
            passed: p['passed'],
            expected: p['expected'],
            actual: p['actual'],
            severity: p['severity'],
            schemaDiff: p['schemaDiff'],
            attempt: p['attempt'] ?? 1,
          };
        });
      return {
        stepIndex,
        phase: stepIndex >= mainSteps.length && plannedSteps.length > 0 ? 'teardown' : 'main',
        name:
          definitions.find((step) => step.id === planStep?.stepId)?.name ?? `步骤 ${stepIndex + 1}`,
        method: prepared['method'] ?? planStep?.method,
        // Only expose the Runner-redacted URL, never the raw frozen request.
        url: prepared['url'],
        events,
        assertions,
        error: finished['error'],
        status: events.length ? inferStepStatus(events) : 'not_run',
        durationMs: inferStepDuration(events),
      };
    });

  return {
    run: {
      id: run.id,
      sourceName: run.source_name,
      apiVersionId: run.api_version_id,
      workflowVersionId: run.workflow_version_id,
      testCaseVersionId: run.test_case_version_id,
      environmentVersionId: run.plan_json?.environmentVersionId ?? null,
      status: run.status,
      runnerId: run.runner_id,
      claimedAt: run.claimed_at,
      createdAt: run.created_at,
      finishedAt: run.finished_at,
    },
    steps,
    runEvents,
  };
}

function inferStepStatus(
  events: StepEventRow[],
): 'passed' | 'failed' | 'error' | 'skipped' | 'unknown' {
  const lastStepFinished = events.filter((e) => e.eventType === 'step.finished').at(-1);
  if (lastStepFinished) {
    const payload = lastStepFinished.payload as Record<string, unknown>;
    const status = payload?.['status'];
    return status === 'passed' || status === 'failed' || status === 'error' || status === 'skipped'
      ? status
      : 'unknown';
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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
