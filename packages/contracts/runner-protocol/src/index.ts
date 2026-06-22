/**
 * @tap/runner-protocol — Runner Protocol v1
 *
 * Defines everything the Runner and Control Plane need to agree on:
 * - ExecutionPlan: the immutable, compiled plan the Runner executes.
 * - RunEvent: ordered, idempotent events the Runner uploads.
 * - Runner lifecycle: register, heartbeat, lease, complete.
 * - Run state machine: queued → leased → running → terminal.
 *
 * Invariants:
 * - The Runner never executes mutable editor documents; only ExecutionPlans.
 * - RunEvents are (runId, sequence) unique — duplicate uploads are idempotent.
 * - Secrets are resolved by the Runner, never appear in events.
 * - Sensitive data is redacted on the Runner side before upload.
 * - Lease expiry does not auto-create a second concurrent execution.
 */

import {
  ContentHashSchema,
  EntityIdSchema,
  HttpMethodSchema,
  HttpStatusCodeSchema,
  InstantSchema,
  SemanticVersionSchema,
  SideEffectLevelSchema,
} from '@tap/contracts-common';
import { z } from 'zod';

// ─── Schema Version ─────────────────────────────────────────────

export const RUNNER_PROTOCOL_VERSION = 'tap.runner-protocol/v1';

// ─── Execution Plan ─────────────────────────────────────────────

/**
 * A compiled, immutable plan. Every field is concrete — no variable
 * references remain unresolved (only runtime values differ).
 */
export const FrozenStepSchema = z.object({
  /** Stable step id from the workflow. */
  stepId: EntityIdSchema,
  /** 0-based sequence in the main workflow. */
  sequence: z.number().int().nonnegative(),
  /** The concrete HTTP request with all variable refs resolved to VarRefs. */
  method: HttpMethodSchema,
  urlTemplate: z.string().min(1).max(4096),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  /** Maximum retry count. */
  maxRetries: z.number().int().min(0).max(10).default(0),
  /** Retry backoff configuration. */
  retryBaseDelayMs: z.number().int().positive().max(60_000).default(1000),
  retryBackoffMultiplier: z.number().min(1).max(10).default(2),
  retryOnStatuses: z.array(HttpStatusCodeSchema).optional(),
  retryOnNetworkError: z.boolean().default(true),
  /** Polling configuration. */
  pollIntervalMs: z.number().int().positive().max(60_000).optional(),
  pollMaxDurationMs: z.number().int().positive().max(600_000).optional(),
  pollMaxAttempts: z.number().int().positive().max(10_000).optional(),
  pollUntilExpression: z.string().max(1024).optional(),
  /** Condition for execution. */
  conditionExpression: z.string().max(1024).optional(),
  conditionOnFalse: z.enum(['skip', 'fail']).optional(),
  /** Failure strategy. */
  onFailure: z.enum(['stop', 'skip', 'teardown-and-stop']).default('stop'),
  /** Assertions to evaluate. */
  assertions: z.array(
    z.object({
      id: EntityIdSchema,
      description: z.string().max(1024).optional(),
      target: z.enum(['status', 'header', 'jsonPath', 'body', 'responseTime', 'schema']),
      path: z.string().max(1024).optional(),
      operator: z.enum([
        'equals',
        'notEquals',
        'contains',
        'notContains',
        'exists',
        'notExists',
        'greaterThan',
        'lessThan',
        'matches',
        'type',
        'schema',
        'hasItems',
        'isEmpty',
      ]),
      expected: z.unknown().optional(),
      severity: z.enum(['block', 'warn']).default('block'),
    }),
  ),
  /** Variable extractions. */
  extractions: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        source: z.enum(['body', 'header', 'cookie', 'status']),
        expression: z.string().min(1).max(1024),
        scope: z.enum(['step', 'workflow']).default('workflow'),
        sensitive: z.boolean().default(false),
      }),
    )
    .optional(),
  /** Side effect classification. */
  sideEffect: SideEffectLevelSchema.default('read-only'),
  /** Whether this step is enabled. */
  enabled: z.boolean().default(true),
  /** Request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  /** Origin: the TestCaseVersion or inline definition hash. */
  originTestVersionId: EntityIdSchema.optional(),
  originContentHash: ContentHashSchema.optional(),
});
export type FrozenStep = z.infer<typeof FrozenStepSchema>;

export const FrozenTeardownStepSchema = FrozenStepSchema.pick({
  stepId: true,
  sequence: true,
  method: true,
  urlTemplate: true,
  headers: true,
  query: true,
  body: true,
  assertions: true,
  extractions: true,
  sideEffect: true,
  enabled: true,
  timeoutMs: true,
  originTestVersionId: true,
  originContentHash: true,
}).extend({
  maxRetries: z.number().int().min(0).max(3).default(1),
});
export type FrozenTeardownStep = z.infer<typeof FrozenTeardownStepSchema>;

/**
 * The ExecutionPlan is the compiled, immutable artifact that the Runner
 * executes. It's created by the Workflow Compiler at publish time.
 */
export const ExecutionPlanSchema = z.object({
  /** Protocol version. */
  schemaVersion: z.literal(RUNNER_PROTOCOL_VERSION),
  /** Unique plan identifier. */
  planId: EntityIdSchema,
  /** Content hash of the entire plan (for integrity checks). */
  planHash: ContentHashSchema,
  /** The workflow version this plan was compiled from. */
  workflowVersionId: EntityIdSchema,
  /** When this plan was compiled. */
  compiledAt: InstantSchema,
  /** Sequential main-workflow steps, in order. */
  steps: z.array(FrozenStepSchema).min(1).max(50),
  /** Optional teardown phase. */
  teardown: z
    .object({
      strategy: z.enum(['always', 'on-success', 'on-failure', 'never']).default('always'),
      steps: z.array(FrozenTeardownStepSchema).max(20),
    })
    .optional(),
});
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ─── Run Snapshot ───────────────────────────────────────────────

/**
 * A Run Snapshot is created when a run is triggered. It freezes all input
 * versions so the run is fully reproducible.
 */
export const RunSnapshotSchema = z.object({
  runId: EntityIdSchema,
  /** The execution plan (embedded or referenced by hash). */
  planHash: ContentHashSchema,
  /** Frozen input versions. */
  apiVersionId: EntityIdSchema.optional(),
  testSuiteVersionId: EntityIdSchema.optional(),
  environmentVersionId: EntityIdSchema,
  /** Secret references (values are NOT included). */
  secretRefs: z.array(z.string().min(1).max(256)),
  /** Git commit that triggered this run. */
  gitCommitSha: z.string().max(40).optional(),
  /** Trigger information. */
  trigger: z.object({
    type: z.enum(['manual', 'cli', 'webhook', 'schedule', 'ci']),
    principal: z.string().min(1).max(128),
    idempotencyKey: z.string().max(256).optional(),
  }),
  /** When the snapshot was created. */
  createdAt: InstantSchema,
});
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

// ─── Run State Machine ──────────────────────────────────────────

export const RunStateSchema = z.enum([
  'queued',
  'leased',
  'running',
  'passed',
  'failed',
  'inconclusive',
  'cancelled',
  'orphaned',
]);
export type RunState = z.infer<typeof RunStateSchema>;

/**
 * Valid state transitions. Any transition not listed here is rejected.
 */
export const VALID_RUN_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  queued: ['leased', 'cancelled'],
  leased: ['running', 'queued'],
  running: ['passed', 'failed', 'inconclusive', 'cancelled', 'orphaned'],
  passed: [],
  failed: [],
  inconclusive: [],
  cancelled: [],
  orphaned: ['inconclusive', 'queued'],
};

// ─── Run Events ─────────────────────────────────────────────────

/**
 * Every event has a unique (runId, sequence) pair. Sequence starts at 1.
 * Duplicate uploads with the same (runId, sequence) are idempotent.
 */
export const RunEventMetaSchema = z.object({
  runId: EntityIdSchema,
  /** Monotonically increasing event sequence number. */
  sequence: z.number().int().positive(),
  /** When the event occurred (Runner clock). */
  timestamp: InstantSchema,
  /** Which attempt number this belongs to (1-based). */
  attempt: z.number().int().positive().default(1),
  /** Step this event relates to. */
  stepId: EntityIdSchema,
  /** W3C Trace Context traceparent. */
  traceId: z.string().max(64).optional(),
  /** Content hash of the event payload (for integrity). */
  payloadHash: ContentHashSchema.optional(),
});
export type RunEventMeta = z.infer<typeof RunEventMetaSchema>;

export const RunStartedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('run.started'),
  /** Runner identity that picked up the task. */
  runnerId: z.string().min(1).max(128),
  runnerVersion: SemanticVersionSchema,
});
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

export const StepStartedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('step.started'),
  /** Resolved URL (with secrets redacted). */
  resolvedUrl: z.string().max(4096),
});
export type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;

export const RequestPreparedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('request.prepared'),
  /** Redacted headers. */
  headers: z.record(z.string(), z.string()),
  /** Method and URL. */
  method: HttpMethodSchema,
  url: z.string().max(4096),
  /** Body size in bytes (redacted content). */
  bodySizeBytes: z.number().int().nonnegative().optional(),
});
export type RequestPreparedEvent = z.infer<typeof RequestPreparedEventSchema>;

export const RequestSentEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('request.sent'),
  /** When the request was sent. */
  sentAt: InstantSchema,
});
export type RequestSentEvent = z.infer<typeof RequestSentEventSchema>;

export const ResponseReceivedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('response.received'),
  statusCode: HttpStatusCodeSchema,
  /** Redacted response headers. */
  headers: z.record(z.string(), z.string()),
  /** Body size in bytes. */
  bodySizeBytes: z.number().int().nonnegative(),
  /** Duration from request sent to response received in ms. */
  durationMs: z.number().int().nonnegative(),
  /** Reference to the full response body in object storage. */
  bodyArtifactRef: z.string().max(512).optional(),
  /** Truncated, redacted body preview (max 4KB). */
  bodyPreview: z.string().max(4096).optional(),
});
export type ResponseReceivedEvent = z.infer<typeof ResponseReceivedEventSchema>;

export const VariableExtractedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('variable.extracted'),
  /** Variable name (value is never included for sensitive vars). */
  name: z.string().min(1).max(128),
  sensitive: z.boolean().default(false),
  /** Redacted or public value. */
  valuePreview: z.string().max(256).optional(),
  /** Where the value was extracted from. */
  source: z.enum(['body', 'header', 'cookie', 'status']),
});
export type VariableExtractedEvent = z.infer<typeof VariableExtractedEventSchema>;

export const AssertionEvaluatedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('assertion.evaluated'),
  assertionId: EntityIdSchema,
  passed: z.boolean(),
  /** Human-readable description. */
  description: z.string().max(1024).optional(),
  /** Expected value (redacted). */
  expected: z.string().max(1024).optional(),
  /** Actual value (redacted). */
  actual: z.string().max(4096).optional(),
  /** For schema failures: field path and diff. */
  schemaDiff: z.string().max(4096).optional(),
  severity: z.enum(['block', 'warn']),
});
export type AssertionEvaluatedEvent = z.infer<typeof AssertionEvaluatedEventSchema>;

export const StepRetriedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('step.retried'),
  /** Reason for the retry. */
  reason: z.string().max(1024),
  /** Which retry attempt this is. */
  retryNumber: z.number().int().positive(),
});
export type StepRetriedEvent = z.infer<typeof StepRetriedEventSchema>;

export const StepFinishedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('step.finished'),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  /** Total duration in ms including retries. */
  totalDurationMs: z.number().int().nonnegative(),
  /** Summary of assertion results. */
  assertionsPassed: z.number().int().nonnegative(),
  assertionsFailed: z.number().int().nonnegative(),
  /** Number of retries executed. */
  retries: z.number().int().nonnegative().default(0),
  /** Error information if status is "error". */
  error: z
    .object({
      type: z.enum(['timeout', 'network', 'dns', 'tls', 'parse', 'policy', 'unknown']),
      message: z.string().max(2048),
    })
    .optional(),
});
export type StepFinishedEvent = z.infer<typeof StepFinishedEventSchema>;

export const TeardownStartedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('teardown.started'),
  /** Why teardown was triggered. */
  reason: z.enum(['workflow-completed', 'workflow-failed', 'workflow-cancelled']),
});
export type TeardownStartedEvent = z.infer<typeof TeardownStartedEventSchema>;

export const RunFinishedEventSchema = RunEventMetaSchema.extend({
  eventType: z.literal('run.finished'),
  terminalState: z.enum(['passed', 'failed', 'inconclusive', 'cancelled']),
  /** Summary statistics. */
  totalSteps: z.number().int().positive(),
  stepsPassed: z.number().int().nonnegative(),
  stepsFailed: z.number().int().nonnegative(),
  stepsSkipped: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});
export type RunFinishedEvent = z.infer<typeof RunFinishedEventSchema>;

/** Discriminated union of all run events. */
export const RunEventSchema = z.discriminatedUnion('eventType', [
  RunStartedEventSchema,
  StepStartedEventSchema,
  RequestPreparedEventSchema,
  RequestSentEventSchema,
  ResponseReceivedEventSchema,
  VariableExtractedEventSchema,
  AssertionEvaluatedEventSchema,
  StepRetriedEventSchema,
  StepFinishedEventSchema,
  TeardownStartedEventSchema,
  RunFinishedEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

// ─── Runner Lifecycle ───────────────────────────────────────────

export const RunnerCapabilitiesSchema = z.object({
  /** Network labels, e.g. ["us-east-1", "internal"]. */
  labels: z.array(z.string().max(128)),
  /** Maximum concurrent tasks. */
  maxConcurrency: z.number().int().positive().max(1000),
  /** Supported protocol versions. */
  protocolVersions: z.array(SemanticVersionSchema),
  /** Runner binary version. */
  runnerVersion: SemanticVersionSchema,
  /** Node.js / runtime version. */
  runtimeVersion: z.string().max(128),
});
export type RunnerCapabilities = z.infer<typeof RunnerCapabilitiesSchema>;

export const RunnerRegistrationSchema = z.object({
  runnerId: EntityIdSchema,
  capabilities: RunnerCapabilitiesSchema,
  /** Base URL for health checks (optional). */
  healthUrl: z.string().url().optional(),
});
export type RunnerRegistration = z.infer<typeof RunnerRegistrationSchema>;

export const HeartbeatSchema = z.object({
  runnerId: EntityIdSchema,
  /** Current load. */
  activeTasks: z.number().int().nonnegative(),
  /** When this heartbeat was sent. */
  timestamp: InstantSchema,
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;

export const WorkLeaseSchema = z.object({
  leaseId: EntityIdSchema,
  runId: EntityIdSchema,
  /** The signed execution plan reference. */
  planRef: z.string().max(512),
  /** Lease expiration time. */
  expiresAt: InstantSchema,
  /** Short-lived authorization for secret resolution. */
  secretAuthToken: z.string().max(1024).optional(),
});
export type WorkLease = z.infer<typeof WorkLeaseSchema>;

export const LeaseAckSchema = z.object({
  leaseId: EntityIdSchema,
  runId: EntityIdSchema,
  /** Whether the Runner accepts this lease. */
  accepted: z.boolean(),
  /** If rejected, why. */
  rejectReason: z.string().max(1024).optional(),
});
export type LeaseAck = z.infer<typeof LeaseAckSchema>;

// ─── Quality Gate ───────────────────────────────────────────────

export const QualityGateResultSchema = z.enum([
  'passed',
  'failed',
  'blocked',
  'inconclusive',
  'cancelled',
]);
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

export const QualityGateConfigSchema = z.object({
  /** All critical workflows must pass. */
  requireCriticalWorkflows: z.boolean().default(true),
  /** No new failures allowed. */
  allowNoNewFailures: z.boolean().default(true),
  /** Maximum allowed flaky/retry count. */
  maxFlakyCount: z.number().int().nonnegative().optional(),
  /** Minimum endpoint coverage percentage. */
  minCoveragePercent: z.number().min(0).max(100).optional(),
  /** Specific tags that must pass. */
  requiredTags: z.array(z.string().max(64)).optional(),
});
export type QualityGateConfig = z.infer<typeof QualityGateConfigSchema>;
