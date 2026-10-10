import { describe, expect, test } from 'vitest';
import { GenerationTaskSchema, validateGenerationResult } from '../index.js';

const task = GenerationTaskSchema.parse({
  schemaVersion: 'sketch-test.generation/v1',
  jobId: 'job_1',
  workspaceId: 'ws_1',
  apiVersionId: 'av_1',
  sourceHash: 'a'.repeat(64),
  objective: 'Read health',
  modelTarget: { provider: 'deepseek', model: 'deepseek-v4-flash' },
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
});
const result = {
  schemaVersion: task.schemaVersion,
  jobId: task.jobId,
  workspaceId: task.workspaceId,
  apiVersionId: task.apiVersionId,
  sourceHash: task.sourceHash,
  inputHash: 'b'.repeat(64),
  harness: 'pi-agent-core',
  harnessVersion: '0.85.1',
  promptVersion: '1.0.0',
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  turns: 2,
  drafts: [
    {
      endpointId: 'health',
      status: 'pending',
      rationale: '200 is documented.',
      definition: {
        schemaVersion: 'sketch-test.test/v1',
        id: 'test_health',
        name: 'Health',
        sideEffect: 'read-only',
        request: { method: 'GET', url: '${env.baseUrl}/health' },
        assertions: [{ id: 'ok', target: 'status', operator: 'equals', expected: 200 }],
      },
    },
  ],
};
describe('receiving boundary', () => {
  test('accepts a source-matched result', () =>
    expect(validateGenerationResult(task, result.inputHash, result).drafts).toHaveLength(1));
  test.each([
    'workspaceId',
    'apiVersionId',
    'sourceHash',
    'inputHash',
    'model',
    'provider',
  ] as const)('rejects mismatched %s', (field) => {
    expect(() =>
      validateGenerationResult(task, result.inputHash, { ...result, [field]: 'c'.repeat(64) }),
    ).toThrow();
  });
  test('rejects invented endpoint, status, risk and duplicate identities', () => {
    for (const mutate of [
      (r: typeof result) => {
        r.drafts[0]!.endpointId = 'other';
      },
      (r: typeof result) => {
        r.drafts[0]!.definition.assertions[0]!.expected = 204;
      },
      (r: typeof result) => {
        r.drafts[0]!.definition.sideEffect = 'high-risk';
      },
      (r: typeof result) => {
        r.drafts.push(r.drafts[0]!);
      },
    ]) {
      const invalid = structuredClone(result);
      mutate(invalid);
      expect(() => validateGenerationResult(task, result.inputHash, invalid)).toThrow();
    }
  });
});
