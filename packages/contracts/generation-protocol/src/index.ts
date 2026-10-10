/**
 * Generation protocol v1 — the independent AI Worker boundary.
 * Inputs are an explicitly curated API projection, never secrets or raw repositories.
 * Outputs are unreviewed GeneratedDrafts; this protocol cannot publish or execute tests.
 * Source hashes identify caller-owned immutable evidence; inputHash identifies this job.
 */
import {
  ContentHashSchema,
  EntityIdSchema,
  HttpMethodSchema,
  SemanticVersionSchema,
  SideEffectLevelSchema,
} from '@sketch-test/contracts-common';
import { TestDefinitionSchema } from '@sketch-test/test-dsl';
import { z } from 'zod/v3';

export const GENERATION_PROTOCOL_VERSION = 'sketch-test.generation/v1';

export const GenerationEndpointSchema = z
  .object({
    id: EntityIdSchema,
    method: HttpMethodSchema,
    path: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^\/(?!\/)/),
    summary: z.string().max(1024),
    contractNotes: z.string().max(4096).default(''),
    responseStatusCodes: z.array(z.number().int().min(100).max(599)).min(1).max(30),
    // The caller classifies risk; the model must not downgrade it.
    sideEffect: SideEffectLevelSchema,
  })
  .strict();

export const GenerationTaskSchema = z
  .object({
    schemaVersion: z.literal(GENERATION_PROTOCOL_VERSION),
    jobId: EntityIdSchema,
    workspaceId: EntityIdSchema,
    apiVersionId: EntityIdSchema,
    sourceHash: ContentHashSchema,
    objective: z.string().min(1).max(4096),
    modelTarget: z
      .object({ provider: z.string().min(1).max(128), model: z.string().min(1).max(256) })
      .strict()
      .optional(),
    endpoints: z.array(GenerationEndpointSchema).min(1).max(100),
    limits: z
      .object({
        maxTurns: z.number().int().min(1).max(20).default(6),
        maxDrafts: z.number().int().min(1).max(20).default(5),
        timeoutMs: z.number().int().min(100).max(300000).default(60000),
        maxOutputTokens: z.number().int().min(128).max(8192).default(4096),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((task, ctx) => {
    if (new Set(task.endpoints.map((endpoint) => endpoint.id)).size !== task.endpoints.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endpoints'],
        message: 'Duplicate endpoint IDs',
      });
    }
  });
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;

export const GeneratedDraftSchema = z
  .object({
    endpointId: EntityIdSchema,
    definition: TestDefinitionSchema.refine((definition) => definition.assertions.length > 0, {
      message: 'Generated tests require at least one assertion',
    }),
    rationale: z.string().min(1).max(4096),
    status: z.literal('pending'),
  })
  .strict();
export type GeneratedDraft = z.infer<typeof GeneratedDraftSchema>;

export const GenerationResultSchema = z
  .object({
    schemaVersion: z.literal(GENERATION_PROTOCOL_VERSION),
    jobId: EntityIdSchema,
    workspaceId: EntityIdSchema,
    apiVersionId: EntityIdSchema,
    sourceHash: ContentHashSchema,
    inputHash: ContentHashSchema,
    harness: z.literal('pi-agent-core'),
    harnessVersion: SemanticVersionSchema,
    promptVersion: SemanticVersionSchema,
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    turns: z.number().int().positive(),
    drafts: z.array(GeneratedDraftSchema).min(1).max(20),
  })
  .strict();
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

export const WorkerIdentitySchema = z
  .object({
    capabilities: z.array(z.literal('plan')).optional(),
    workerId: EntityIdSchema,
    provider: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    harnessVersion: SemanticVersionSchema,
  })
  .strict();
export type WorkerIdentity = z.infer<typeof WorkerIdentitySchema>;
export const GenerationLeaseSchema = z
  .object({
    task: GenerationTaskSchema,
    leaseToken: z.string().uuid(),
    attempt: z.number().int().positive(),
  })
  .strict();
export type GenerationLease = z.infer<typeof GenerationLeaseSchema>;

/** Bind path parameters to explicitly configured environment inputs. */
export function generationRequestUrl(path: string): string {
  const bound = path
    .replace(
      /(^|\/):([A-Za-z_][A-Za-z0-9_-]*)/g,
      (_match, prefix: string, name: string) => `${prefix}\${env.${name}}`,
    )
    .replace(/(?<!\$)\{([^{}]+)\}/g, (_match, name: string) => `\${env.${name}}`);
  return `\${env.baseUrl}${bound}`;
}

/** Pure validation shared by the harness boundary and the receiving control plane. */
export function validateGenerationResult(
  task: GenerationTask,
  inputHash: string,
  input: unknown,
): GenerationResult {
  const result = GenerationResultSchema.parse(input);
  for (const field of ['jobId', 'workspaceId', 'apiVersionId', 'sourceHash'] as const) {
    if (result[field] !== task[field]) throw new Error(`Mismatched ${field}`);
  }
  if (result.inputHash !== inputHash) throw new Error('Mismatched input hash');
  if (
    task.modelTarget &&
    (result.provider !== task.modelTarget.provider || result.model !== task.modelTarget.model)
  )
    throw new Error('Mismatched model');
  if (result.turns > task.limits.maxTurns || result.drafts.length > task.limits.maxDrafts)
    throw new Error('Generation budget exceeded');
  const ids = new Set<string>();
  for (const draft of result.drafts) {
    const endpoint = task.endpoints.find((item) => item.id === draft.endpointId);
    const definition = draft.definition;
    if (
      !endpoint ||
      definition.request.method !== endpoint.method ||
      definition.request.url !== generationRequestUrl(endpoint.path) ||
      definition.sideEffect !== endpoint.sideEffect
    )
      throw new Error('Draft differs from source endpoint');
    if (
      !definition.assertions.some(
        (a) =>
          a.target === 'status' &&
          a.operator === 'equals' &&
          endpoint.responseStatusCodes.includes(Number(a.expected)),
      )
    )
      throw new Error('Documented status assertion required');
    if (ids.has(definition.id)) throw new Error('Duplicate draft ID');
    ids.add(definition.id);
    delete definition.generationSource;
  }
  return result;
}

export * from './plan.js';
