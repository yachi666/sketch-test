/**
 * @tap/workflow-dsl — Workflow Definition DSL v1
 *
 * Defines the structure of a multi-step API workflow. This is the human-editable
 * format consumed by the workflow editor. The Workflow Compiler transforms this
 * into an immutable ExecutionPlan for the Runner.
 *
 * Invariants:
 * - Published WorkflowVersions are immutable.
 * - All variable references are checked at compile time.
 * - Loops, polls, and retries have explicit upper bounds.
 * - Teardown forms an independent phase with configurable failure strategy.
 * - The Runner never directly executes mutable editor documents.
 */

import {
  ContentHashSchema,
  DiagnosticSchema,
  EntityIdSchema,
  HttpStatusCodeSchema,
  ImmutableVersionMetaSchema,
} from '@tap/contracts-common';
import { z } from 'zod';

// ─── Schema Version ─────────────────────────────────────────────

export const WORKFLOW_DSL_VERSION = 'tap.workflow/v1';

// ─── Step Reference ─────────────────────────────────────────────

/**
 * A workflow step can either reference a published TestCaseVersion (stable)
 * or define an inline request (convenient for quick prototyping).
 */
export const StepTestRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('test-version'),
    /** Reference to a published TestCaseVersion id. */
    testVersionId: EntityIdSchema,
  }),
  z.object({
    kind: z.literal('inline'),
    /** Inline test definition (will be frozen at publish time). */
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    url: z.string().min(1).max(4096),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.unknown().optional(),
  }),
]);
export type StepTestRef = z.infer<typeof StepTestRefSchema>;

// ─── Control Logic ──────────────────────────────────────────────

export const RetryConfigSchema = z.object({
  /** Maximum number of retries (capped at 10). */
  maxRetries: z.number().int().min(0).max(10).default(0),
  /** Base delay between retries in milliseconds. */
  baseDelayMs: z.number().int().positive().max(60_000).default(1000),
  /** Backoff multiplier. */
  backoffMultiplier: z.number().min(1).max(10).default(2),
  /** HTTP status codes that trigger a retry. */
  retryOnStatus: z.array(HttpStatusCodeSchema).optional(),
  /** Whether to retry on network errors. */
  retryOnNetworkError: z.boolean().default(true),
});
export type RetryConfig = z.infer<typeof RetryConfigSchema>;

export const PollConfigSchema = z.object({
  /** Polling interval in milliseconds. */
  intervalMs: z.number().int().positive().max(60_000).default(2000),
  /** Hard deadline: maximum polling duration. */
  maxDurationMs: z.number().int().positive().max(600_000),
  /** Or maximum number of polls. One of maxDurationMs or maxAttempts must be set. */
  maxAttempts: z.number().int().positive().max(10_000).optional(),
  /** Expression that must evaluate to true to stop polling. */
  untilExpression: z.string().min(1).max(1024),
});
export type PollConfig = z.infer<typeof PollConfigSchema>;

export const ConditionConfigSchema = z.object({
  /** Expression that must be true to execute this step. */
  expression: z.string().min(1).max(1024),
  /** What to do when the condition is false. */
  onFalse: z.enum(['skip', 'fail']).default('skip'),
});
export type ConditionConfig = z.infer<typeof ConditionConfigSchema>;

export const FailureStrategySchema = z.enum([
  /** Stop the workflow immediately. */
  'stop',
  /** Skip this step and continue. */
  'skip',
  /** Jump to a labeled step. */
  'goto',
  /** Execute teardown and stop. */
  'teardown-and-stop',
]);
export type FailureStrategy = z.infer<typeof FailureStrategySchema>;

// ─── Input Mapping ──────────────────────────────────────────────

export const StepInputSchema = z.object({
  /** Target parameter name in the step's request. */
  target: z.string().min(1).max(128),
  /** Expression to compute the value, e.g. "${steps.createUser.userId}". */
  valueExpression: z.string().min(1).max(4096),
});
export type StepInput = z.infer<typeof StepInputSchema>;

// ─── Workflow Step ──────────────────────────────────────────────

/**
 * A single step in a workflow. Steps execute sequentially in V1.
 */
export const WorkflowStepSchema = z.object({
  /** Unique id within the workflow. */
  id: EntityIdSchema,
  /** Human-readable name. */
  name: z.string().min(1).max(256),
  /** What test to execute. */
  useTest: StepTestRefSchema,
  /** Input mappings from previous steps or environment. */
  inputs: z.array(StepInputSchema).optional(),
  /** Condition for execution. */
  condition: ConditionConfigSchema.optional(),
  /** Retry configuration. */
  retry: RetryConfigSchema.optional(),
  /** Polling configuration (step repeats until condition or timeout). */
  poll: PollConfigSchema.optional(),
  /** What to do if this step fails. */
  onFailure: FailureStrategySchema.default('stop'),
  /** Whether this step is enabled. */
  enabled: z.boolean().default(true),
  /** Human-readable description. */
  description: z.string().max(1024).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

// ─── Teardown Phase ─────────────────────────────────────────────

/**
 * Teardown steps run after the main workflow, regardless of success or failure.
 * Strategy controls whether teardown runs on main-workflow failure.
 */
export const TeardownStrategySchema = z.enum([
  /** Always run teardown. */
  'always',
  /** Only run if the main workflow passed. */
  'on-success',
  /** Only run if the main workflow failed. */
  'on-failure',
  /** Never run teardown (user handles cleanup externally). */
  'never',
]);
export type TeardownStrategy = z.infer<typeof TeardownStrategySchema>;

/**
 * Teardown steps are simplified: no conditions, no polling, fixed retry.
 */
export const TeardownStepSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1).max(256),
  useTest: StepTestRefSchema,
  inputs: z.array(StepInputSchema).optional(),
  /** Teardown steps can retry up to 3 times. */
  maxRetries: z.number().int().min(0).max(3).default(1),
  enabled: z.boolean().default(true),
});
export type TeardownStep = z.infer<typeof TeardownStepSchema>;

// ─── Workflow Definition ────────────────────────────────────────

/**
 * A complete workflow definition — the editor document. The Workflow Compiler
 * transforms this into an ExecutionPlan.
 */
export const WorkflowDefinitionSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_DSL_VERSION),
  id: EntityIdSchema,
  /** Human-readable name. */
  name: z.string().min(1).max(256),
  description: z.string().max(4096).optional(),
  tags: z.array(z.string().max(64)).optional(),
  /** Sequential steps in the main workflow. */
  steps: z.array(WorkflowStepSchema).min(1).max(50), // V1 hard limit
  /** Teardown phase. */
  teardown: z
    .object({
      strategy: TeardownStrategySchema.default('always'),
      steps: z.array(TeardownStepSchema).max(20),
    })
    .optional(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ─── Workflow Version ───────────────────────────────────────────

export const WorkflowVersionSchema = z.object({
  ...ImmutableVersionMetaSchema.shape,
  definition: WorkflowDefinitionSchema,
  /** The ExecutionPlan hash generated from this version. */
  planHash: ContentHashSchema.optional(),
});
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

// ─── Compiler Diagnostics ──────────────────────────────────────

export const WorkflowDiagnosticsSchema = z.object({
  valid: z.boolean(),
  diagnostics: z.array(DiagnosticSchema),
  /** Variable references that could not be resolved. */
  unresolvedVariables: z.array(
    z.object({
      stepId: EntityIdSchema,
      variableName: z.string(),
      message: z.string(),
    }),
  ),
  /** Steps with potential issues (e.g., missing inputs). */
  stepWarnings: z.array(
    z.object({
      stepId: EntityIdSchema,
      message: z.string(),
    }),
  ),
});
export type WorkflowDiagnostics = z.infer<typeof WorkflowDiagnosticsSchema>;
