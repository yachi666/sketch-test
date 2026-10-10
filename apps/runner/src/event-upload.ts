import type { ExecutionPlan, RunEvent } from '@sketch-test/runner-protocol';

/** Main and cleanup steps must never share an evidence index. */
export function mapUploadEvents(runId: string, plan: ExecutionPlan, events: RunEvent[]) {
  const steps = [...plan.steps, ...(plan.teardown?.steps ?? [])];
  const indexes = new Map(steps.map((step, index) => [step.stepId, index]));
  return events
    .filter((event) => indexes.has(event.stepId))
    .map((event) => ({
      id: `${runId}-evt-${event.sequence}`,
      runId,
      stepIndex: indexes.get(event.stepId) ?? 0,
      eventType: event.eventType,
      payload: event,
    }));
}
