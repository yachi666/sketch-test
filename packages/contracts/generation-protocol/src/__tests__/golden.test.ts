import { describe, expect, test } from 'vitest';
import { GeneratedDraftSchema, GenerationTaskSchema } from '../index.js';

const task = {
  schemaVersion: 'sketch-test.generation/v1',
  jobId: 'job-1',
  workspaceId: 'ws-1',
  apiVersionId: 'api-1',
  sourceHash: 'a'.repeat(64),
  objective: 'Verify health',
  endpoints: [
    {
      id: 'health',
      method: 'GET',
      path: '/health',
      summary: 'Health',
      responseStatusCodes: [200],
      sideEffect: 'read-only',
    },
  ],
};

describe('generation protocol v1', () => {
  test('freezes the normalized job shape and bounded defaults', () => {
    expect(GenerationTaskSchema.parse(task)).toMatchSnapshot();
  });
  test('rejects duplicate evidence identities, unknown versions and unbounded tasks', () => {
    expect(
      GenerationTaskSchema.safeParse({ ...task, endpoints: [...task.endpoints, ...task.endpoints] })
        .success,
    ).toBe(false);
    expect(GenerationTaskSchema.safeParse({ ...task, schemaVersion: 'v2' }).success).toBe(false);
    expect(GenerationTaskSchema.safeParse({ ...task, limits: { maxTurns: 1000 } }).success).toBe(
      false,
    );
    expect(
      GenerationTaskSchema.safeParse({ ...task, secrets: { token: 'never-allowed' } }).success,
    ).toBe(false);
  });
  test('cannot represent an automatically accepted draft', () => {
    const draft = {
      endpointId: 'health',
      status: 'accepted',
      rationale: 'A documented response',
      definition: {
        schemaVersion: 'sketch-test.test/v1',
        id: 't-1',
        name: 'Health',
        request: { method: 'GET', url: '${env.baseUrl}/health' },
        assertions: [{ id: 'a-1', target: 'status', operator: 'equals', expected: 200 }],
      },
    };
    expect(GeneratedDraftSchema.safeParse(draft).success).toBe(false);
    expect(GeneratedDraftSchema.safeParse({ ...draft, status: 'pending' }).success).toBe(true);
  });
});
