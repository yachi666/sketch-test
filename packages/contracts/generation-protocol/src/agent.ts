/** Agent configuration v1: immutable execution identity, no provider credentials. */
import { z } from 'zod/v3';
export const AgentConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    avatar: z.enum(['contract', 'language', 'plan']),
    capability: z.enum(['test', 'plan']),
    enabled: z.boolean(),
    connectionId: z.string().min(1).max(128),
    model: z.string().trim().min(1).max(256),
    instructions: z.string().trim().min(1).max(2000),
    timeoutMs: z.number().int().min(10000).max(180000),
    retries: z.number().int().min(0).max(3),
    maxOutputTokens: z.number().int().min(128).max(8192),
  })
  .strict();
export const AgentSnapshotSchema = AgentConfigSchema.extend({
  schemaVersion: z.literal('sketch-test.agent/v1'),
  id: z.string().min(1).max(128),
  version: z.number().int().positive(),
  provider: z.string().min(1).max(128),
  connectionRef: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
  connectionName: z.string().min(1).max(80),
}).strict();
export const ConnectionConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    provider: z.enum(['openai', 'deepseek', 'anthropic', 'zai', 'zai-coding-cn']),
    connectionRef: z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),
  })
  .strict();
export const ExecutionEventSchema = z
  .object({
    type: z.enum(['model.completed', 'tool.completed']),
    at: z.string().datetime(),
    durationMs: z.number().nonnegative().optional(),
    tool: z.enum(['read_endpoint', 'propose_test', 'propose_plan']).optional(),
    success: z.boolean(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;
export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
