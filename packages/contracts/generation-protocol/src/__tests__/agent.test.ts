import { expect, test } from 'vitest';
import { AgentSnapshotSchema, ConnectionConfigSchema, ExecutionEventSchema } from '../agent.js';

const snapshot = {
  schemaVersion: 'sketch-test.agent/v1',
  id: 'ag_contract',
  version: 3,
  name: 'Contract Agent',
  avatar: 'contract',
  capability: 'test',
  enabled: true,
  connectionId: 'conn_team',
  connectionName: 'Team OpenAI',
  connectionRef: 'team',
  provider: 'openai',
  model: 'configured-model',
  instructions: 'Use source evidence.',
  timeoutMs: 120000,
  retries: 2,
  maxOutputTokens: 4096,
};
test('Agent v1 wire format freezes identity, connection and behavior together', () => {
  expect(AgentSnapshotSchema.parse(snapshot)).toMatchSnapshot();
});
test('connections reject secrets and Agent configuration is bounded', () => {
  expect(
    ConnectionConfigSchema.safeParse({
      name: 'Team',
      provider: 'openai',
      connectionRef: 'team',
      apiKey: 'forbidden',
    }).success,
  ).toBe(false);
  for (const patch of [
    { version: 0 },
    { retries: 4 },
    { timeoutMs: 999999 },
    { maxOutputTokens: 100000 },
    { connectionRef: 'https://arbitrary.test' },
  ]) {
    expect(AgentSnapshotSchema.safeParse({ ...snapshot, ...patch }).success).toBe(false);
  }
});
test('execution telemetry excludes raw prompts and tool arguments', () => {
  const event = {
    type: 'model.completed',
    at: '2026-10-10T00:00:00.000Z',
    success: true,
    inputTokens: 24,
    outputTokens: 10,
  };
  expect(ExecutionEventSchema.safeParse(event).success).toBe(true);
  expect(ExecutionEventSchema.safeParse({ ...event, prompt: 'raw' }).success).toBe(false);
  expect(ExecutionEventSchema.safeParse({ ...event, inputTokens: -1 }).success).toBe(false);
});
