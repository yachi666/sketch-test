import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { describe, expect, test, vi } from 'vitest';
import { generatePlan } from '../plan-harness.js';

const model: Model<'openai-responses'> = {
  id: 'test-model',
  name: 'Test model',
  api: 'openai-responses',
  provider: 'openai',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 8192,
};
const task = {
  schemaVersion: 'sketch-test.plan-generation/v1',
  jobId: 'plan-1',
  workspaceId: 'ws-1',
  sourceHash: 'a'.repeat(64),
  objective: 'health plan',
  assets: [
    {
      key: 't1',
      id: 't1',
      type: 'test',
      versionId: 'tv1',
      version: 1,
      name: 'Health',
      route: 'GET /health',
      sideEffect: 'read-only',
    },
  ],
  modelTarget: { provider: model.provider, model: model.id },
  limits: { timeoutMs: 1000, maxTurns: 2, maxOutputTokens: 512 },
};
const proposal = {
  name: '健康回归',
  objective: '服务健康',
  explanation: '根据已发布用例',
  members: [{ key: 't1', reason: '健康用例' }],
  gaps: [],
  noNewFailures: true,
  blockOnInfraError: true,
  precautions: [],
};
const propose = (value = proposal): ToolCall => ({
  type: 'toolCall',
  id: 'p1',
  name: 'propose_plan',
  arguments: { proposal: value },
});

function message(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'],
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: 0,
    stopReason,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

/** Script only the provider; use the real Pi loop, tool validation and event lifecycle. */
function scripted(batches: ToolCall[][]) {
  let index = 0;
  return vi.fn<StreamFn>(() => {
    const content = batches[index++] ?? [];
    const response = message(content, content.length ? 'toolUse' : 'stop');
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: content.length ? 'toolUse' : 'stop', message: response });
    stream.end(response);
    return stream;
  });
}

describe('Pi plan harness', () => {
  test('uses actual Pi loop with a review-only tool and frozen model', async () => {
    const streamFn = scripted([[propose()]]);
    const result = await generatePlan(task, { model, streamFn });
    expect(result.proposal).toEqual(proposal);
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      streamFn.mock.calls[0]?.[1].messages.flatMap((message) =>
        message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
      ),
    ).toEqual(['propose_plan']);
  });
  test('rejects invented members even if the provider requests them', async () => {
    await expect(
      generatePlan(task, {
        model,
        streamFn: scripted([
          [propose({ ...proposal, members: [{ key: 'foreign', reason: 'invented' }] })],
        ]),
      }),
    ).rejects.toThrow('No valid plan');
  });
  test('stops at the turn budget after repeated invalid proposals', async () => {
    const invalid = propose({ ...proposal, members: [{ key: 'foreign', reason: 'invented' }] });
    const streamFn = scripted(Array.from({ length: 10 }, () => [invalid]));
    await expect(generatePlan(task, { model, streamFn })).rejects.toThrow('No valid plan');
    expect(streamFn).toHaveBeenCalledTimes(task.limits.maxTurns);
  });
  test('refuses a silently changed model', async () => {
    await expect(
      generatePlan(
        { ...task, modelTarget: { provider: 'other', model: 'other' } },
        { model, streamFn: scripted([]) },
      ),
    ).rejects.toThrow('Model differs');
  });
});
