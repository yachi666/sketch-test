import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { describe, expect, test, vi } from 'vitest';
import { generateDrafts } from '../harness.js';

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
  schemaVersion: 'sketch-test.generation/v1',
  jobId: 'job-1',
  workspaceId: 'ws-1',
  apiVersionId: 'api-1',
  sourceHash: 'a'.repeat(64),
  objective: 'Verify health readiness',
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
  limits: { maxTurns: 4, maxDrafts: 1 },
};
const definition = {
  schemaVersion: 'sketch-test.test/v1',
  id: 'test-health',
  name: 'Health is available',
  request: { method: 'GET', url: '${env.baseUrl}/health' },
  assertions: [{ id: 'status', target: 'status', operator: 'equals', expected: 200 }],
  sideEffect: 'read-only',
};
const read: ToolCall = {
  type: 'toolCall',
  id: 'read-1',
  name: 'read_endpoint',
  arguments: { endpointId: 'health' },
};
const propose = (patch = {}): ToolCall => ({
  type: 'toolCall',
  id: 'propose-1',
  name: 'propose_test',
  arguments: {
    endpointId: 'health',
    definition: { ...definition, ...patch },
    rationale: 'The source documents 200.',
  },
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

describe('Pi draft harness', () => {
  test('runs real tools and binds pending drafts to immutable input provenance', async () => {
    const streamFn = scripted([[read], [propose()]]);
    const result = await generateDrafts(task, { model, streamFn });
    expect(result.drafts[0]?.status).toBe('pending');
    expect(result.sourceHash).toBe(task.sourceHash);
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.turns).toBe(2);
    expect(result.harnessVersion).toBe('1.1.0');
    const context = streamFn.mock.calls[0]?.[1];
    expect(
      context?.messages.flatMap((message) =>
        message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : [],
      ),
    ).toEqual(['read_endpoint', 'propose_test']);
    expect(streamFn.mock.calls[0]?.[2]?.maxTokens).toBe(4096);
  });

  test.each([
    ['unread evidence', [[propose()]]],
    ['foreign endpoint', [[{ ...read, arguments: { endpointId: 'foreign' } }], [propose()]]],
    [
      'arbitrary target URL',
      [[read], [propose({ request: { method: 'GET', url: 'https://example.invalid' } })]],
    ],
    ['empty assertions', [[read], [propose({ assertions: [] })]]],
    [
      'unsupported expected status',
      [
        [read],
        [
          propose({
            assertions: [{ id: 'x', target: 'status', operator: 'equals', expected: 418 }],
          }),
        ],
      ],
    ],
    ['risk downgrade or mismatch', [[read], [propose({ sideEffect: 'irreversible' })]]],
    ['unknown tool', [[{ ...read, name: 'bash' }]]],
  ])('rejects %s without returning a success envelope', async (_label, batches) => {
    await expect(
      generateDrafts(task, { model, streamFn: scripted(batches as ToolCall[][]) }),
    ).rejects.toThrow('No valid drafts');
  });

  test('bounds repeated model turns and limits proposals in a single tool batch', async () => {
    const looping = scripted(Array.from({ length: 10 }, () => [read]));
    await expect(
      generateDrafts({ ...task, limits: { maxTurns: 2 } }, { model, streamFn: looping }),
    ).rejects.toThrow('No valid drafts');
    expect(looping).toHaveBeenCalledTimes(2);
    const result = await generateDrafts(task, {
      model,
      streamFn: scripted([[read], [propose(), { ...propose({ id: 'other' }), id: 'propose-2' }]]),
    });
    expect(result.drafts).toHaveLength(1);
  });

  test('does not call the provider when cancelled before dispatch', async () => {
    const controller = new AbortController();
    controller.abort();
    const streamFn = scripted([]);
    await expect(
      generateDrafts(task, { model, streamFn, signal: controller.signal }),
    ).rejects.toThrow('cancelled');
    expect(streamFn).not.toHaveBeenCalled();
  });

  test('aborts a provider stream on the wall time limit', async () => {
    const streamFn: StreamFn = (_model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      options?.signal?.addEventListener(
        'abort',
        () => {
          const response = message([], 'aborted');
          stream.push({ type: 'error', reason: 'aborted', error: response });
          stream.end(response);
        },
        { once: true },
      );
      return stream;
    };
    await expect(
      generateDrafts({ ...task, limits: { timeoutMs: 100 } }, { model, streamFn }),
    ).rejects.toThrow('timed out');
  });

  test('surfaces provider failure instead of an empty successful result', async () => {
    const streamFn: StreamFn = () => {
      const stream = createAssistantMessageEventStream();
      const response = message([], 'error');
      stream.push({ type: 'error', reason: 'error', error: response });
      stream.end(response);
      return stream;
    };
    await expect(generateDrafts(task, { model, streamFn })).rejects.toThrow('Model request failed');
  });
});
