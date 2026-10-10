import { describe, expect, test } from 'vitest';
import { PlanTaskSchema, validatePlanProposal, validatePlanResult } from '../plan.js';

const task = PlanTaskSchema.parse({
  schemaVersion: 'sketch-test.plan-generation/v1',
  jobId: 'job1',
  workspaceId: 'ws1',
  sourceHash: 'a'.repeat(64),
  objective: '员工回归',
  assets: [
    {
      key: 't1',
      id: 't1',
      type: 'test',
      versionId: 'tv1',
      version: 1,
      name: '删除员工',
      route: 'DELETE /staff/{id}',
      sideEffect: 'high-risk',
    },
    {
      key: 'd1',
      id: 'd1',
      type: 'draft',
      name: '员工查询',
      route: 'GET /staff',
      sideEffect: 'read-only',
    },
  ],
  modelTarget: { provider: 'test', model: 'test' },
  limits: { timeoutMs: 1000, maxTurns: 2, maxOutputTokens: 512 },
});
const proposal = {
  name: '员工计划',
  objective: '保护员工管理',
  explanation: '基于发布版本',
  members: [{ key: 't1', reason: '已发布' }],
  gaps: [{ key: 'd1', reason: '待审核' }],
  noNewFailures: true,
  blockOnInfraError: true,
  precautions: ['准备可清理数据'],
};
describe('plan generation boundary', () => {
  test('separates published members and draft gaps', () =>
    expect(validatePlanProposal(task, proposal)).toEqual(proposal));
  test.each(['d1', 'foreign'])('rejects unpublished or foreign member %s', (key) =>
    expect(() =>
      validatePlanProposal(task, { ...proposal, members: [{ key, reason: 'x' }] }),
    ).toThrow(),
  );
  test('rejects duplicate membership', () =>
    expect(() =>
      validatePlanProposal(task, {
        ...proposal,
        members: [...proposal.members, ...proposal.members],
      }),
    ).toThrow());
  test('rejects published asset disguised as gap', () =>
    expect(() =>
      validatePlanProposal(task, { ...proposal, members: [], gaps: proposal.members }),
    ).toThrow());
  test('rejects empty plan', () =>
    expect(() => validatePlanProposal(task, { ...proposal, members: [], gaps: [] })).toThrow());
  test('allows gaps-only draft but does not claim execution readiness', () =>
    expect(validatePlanProposal(task, { ...proposal, members: [] }).members).toEqual([]));
  test('binds result to workspace, model and exact snapshot', () => {
    const result = {
      schemaVersion: task.schemaVersion,
      jobId: task.jobId,
      workspaceId: task.workspaceId,
      sourceHash: task.sourceHash,
      inputHash: 'b'.repeat(64),
      provider: 'test',
      model: 'test',
      proposal,
    };
    expect(validatePlanResult(task, result.inputHash, result)).toEqual(result);
    for (const key of ['jobId', 'workspaceId', 'sourceHash', 'inputHash', 'provider', 'model'])
      expect(() =>
        validatePlanResult(task, result.inputHash, { ...result, [key]: 'foreign' }),
      ).toThrow();
  });
  test('serializes the versioned proposal golden shape', () => expect(proposal).toMatchSnapshot());
});
