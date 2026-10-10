/** Plan generation v1: curated asset identities in, review-only proposals out. */
import { ContentHashSchema, EntityIdSchema } from '@sketch-test/contracts-common';
import { z } from 'zod/v3';
import { AgentSnapshotSchema, ExecutionEventSchema } from './agent.js';

export const PlanAssetSchema = z
  .object({
    key: EntityIdSchema,
    id: EntityIdSchema,
    type: z.enum(['test', 'workflow', 'draft']),
    versionId: EntityIdSchema.optional(),
    version: z.number().int().positive().optional(),
    name: z.string().max(255),
    route: z.string().max(2048),
    sideEffect: z.string().max(64),
    apiVersionId: z.string().optional(),
  })
  .strict();
export const PlanProposalSchema = z
  .object({
    name: z.string().min(1).max(120),
    objective: z.string().min(1).max(2000),
    explanation: z.string().min(1).max(3000),
    members: z
      .array(z.object({ key: EntityIdSchema, reason: z.string().min(1).max(800) }).strict())
      .max(100),
    gaps: z
      .array(z.object({ key: EntityIdSchema, reason: z.string().min(1).max(800) }).strict())
      .max(100),
    noNewFailures: z.boolean(),
    blockOnInfraError: z.boolean(),
    precautions: z.array(z.string().min(1).max(600)).max(10),
  })
  .strict();
export const PlanTaskSchema = z
  .object({
    schemaVersion: z.literal('sketch-test.plan-generation/v1'),
    jobId: EntityIdSchema,
    workspaceId: EntityIdSchema,
    sourceHash: ContentHashSchema,
    objective: z.string().min(1).max(4096),
    assets: z.array(PlanAssetSchema).min(1).max(150),
    previous: PlanProposalSchema.optional(),
    agent: AgentSnapshotSchema.optional(),
    modelTarget: z.object({ provider: z.string(), model: z.string() }).strict(),
    limits: z
      .object({
        timeoutMs: z.number().int().min(100).max(180000),
        maxTurns: z.number().int().min(1).max(8),
        maxOutputTokens: z.number().int().min(128).max(8192),
      })
      .strict(),
  })
  .strict();
export const PlanResultSchema = z
  .object({
    schemaVersion: z.literal('sketch-test.plan-generation/v1'),
    jobId: EntityIdSchema,
    workspaceId: EntityIdSchema,
    sourceHash: ContentHashSchema,
    inputHash: ContentHashSchema,
    provider: z.string(),
    model: z.string(),
    events: z.array(ExecutionEventSchema).max(200).optional(),
    proposal: PlanProposalSchema,
  })
  .strict();
export const PlanLeaseSchema = z
  .object({
    task: PlanTaskSchema,
    leaseToken: z.string().uuid(),
    attempt: z.number().int().positive(),
  })
  .strict();
export type PlanTask = z.infer<typeof PlanTaskSchema>;
export type PlanProposal = z.infer<typeof PlanProposalSchema>;
export type PlanAsset = z.infer<typeof PlanAssetSchema>;
export type PlanLease = z.infer<typeof PlanLeaseSchema>;
export function validatePlanProposal(task: PlanTask, input: unknown): PlanProposal {
  const proposal = PlanProposalSchema.parse(input);
  const keys = new Set<string>();
  for (const [items, draft] of [
    [proposal.members, false],
    [proposal.gaps, true],
  ] as const) {
    for (const item of items) {
      const asset = task.assets.find((a) => a.key === item.key);
      if (
        !asset ||
        (asset.type === 'draft') !== draft ||
        (!draft && !asset.versionId) ||
        keys.has(item.key)
      )
        throw new Error('Unknown, duplicate or unpublished plan member');
      keys.add(item.key);
    }
  }
  if (!keys.size) throw new Error('Empty proposal');
  return proposal;
}
export function validatePlanResult(task: PlanTask, inputHash: string, input: unknown) {
  const result = PlanResultSchema.parse(input);
  if (
    result.jobId !== task.jobId ||
    result.workspaceId !== task.workspaceId ||
    result.sourceHash !== task.sourceHash ||
    result.inputHash !== inputHash ||
    result.provider !== task.modelTarget.provider ||
    result.model !== task.modelTarget.model
  )
    throw new Error('Plan provenance mismatch');
  validatePlanProposal(task, result.proposal);
  return result;
}
