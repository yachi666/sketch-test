import { ExecutionPlanSchema, RunEventSchema } from '@sketch-test/runner-protocol';
import { expect, test } from 'vitest';
import { mapUploadEvents } from '../event-upload';

test('keeps cleanup evidence separate and omits phase markers from step uploads', () => {
  const plan = ExecutionPlanSchema.parse({
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId: 'plan_test',
    adHocRunId: 'run_test',
    planHash: 'a'.repeat(64),
    compiledAt: '2026-09-23T00:00:00Z',
    steps: [
      {
        stepId: 'main',
        sequence: 0,
        method: 'GET',
        urlTemplate: 'https://example.com',
        onFailure: 'stop',
        assertions: [],
        extractions: [],
        sideEffect: 'read-only',
        enabled: true,
        timeoutMs: 1000,
      },
    ],
    teardown: {
      steps: [
        {
          stepId: 'cleanup',
          sequence: 0,
          assertions: [],
          method: 'DELETE',
          urlTemplate: 'https://example.com/temporary',
          enabled: true,
          timeoutMs: 1000,
        },
      ],
    },
  });
  const events = ['main', 'cleanup', 'run'].map((stepId, index) =>
    RunEventSchema.parse({
      schemaVersion: 'sketch-test.runner-protocol/v1',
      runId: 'run_test',
      sequence: index + 1,
      timestamp: '2026-09-23T00:00:00Z',
      attempt: 1,
      stepId,
      eventType: 'step.started',
      resolvedUrl: 'https://example.com',
    }),
  );
  expect(
    mapUploadEvents('run_test', plan, events).map((event) => [
      event.stepIndex,
      event.payload.stepId,
    ]),
  ).toEqual([
    [0, 'main'],
    [1, 'cleanup'],
  ]);
});
