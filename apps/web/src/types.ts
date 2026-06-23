import type { EntityId, HttpMethod, VariableScope } from '@sketch-test/contracts-common';

// ─── Navigation ─────────────────────────────────────────────────

export type ViewId =
  | 'overview'
  | 'projects'
  | 'workflows'
  | 'apis'
  | 'cases'
  | 'plans'
  | 'environments'
  | 'variables'
  | 'reports'
  | 'agent'
  | 'team'
  | 'trash';

// ─── UI-specific display types ──────────────────────────────────

export type StepTone = 'brown' | 'amber' | 'green' | 'brick' | 'violet';
export type RunState = 'idle' | 'running' | 'passed' | 'failed';

// ─── Business Process (list-level metadata) ─────────────────────

/** Side-effect classification aligned with CONTEXT.md business processes. */
export type SideEffectLevel = 'readonly' | 'cleanable-write' | 'irreversible';

/** A business process item shown in the workflow list view. */
export interface WorkflowMeta {
  id: string;
  /** BP-01 style identifier. */
  bpId: string;
  name: string;
  description: string;
  /** Number of API steps. */
  stepCount: number;
  /** Key variables passed between steps. */
  variableChain: string[];
  /** Side-effect classification. */
  sideEffect: SideEffectLevel;
  /** Category: normal flow or error path. */
  category: 'normal' | 'error-path';
  status: 'healthy' | 'warning' | 'draft';
  lastRun?: string;
  tags: string[];
}

// ─── Workflow Step (UI model — extends contract concepts) ───────

export interface WorkflowStep {
  id: EntityId;
  name: string;
  method: HttpMethod;
  path: string;
  /** UI display: which icon to show. */
  icon: 'user' | 'lock' | 'cart' | 'card' | 'verify';
  /** UI display: color tone for the card. */
  tone: StepTone;
  /** Variable extracted from this step's response. */
  variableName: string;
  /** JSONPath expression for variable extraction. */
  variablePath: string;
  /** Expected HTTP status code. */
  expectedStatus: number;
  /** Assertion expression, e.g. "$.code = 0". */
  assertion: string;
  /** Source endpoint id from the API catalog (null for manual inline steps). */
  sourceEndpointId?: EntityId;
}

// ─── Execution Log (UI model — aligns with RunEvent concepts) ──

export interface ExecutionLog {
  id: EntityId;
  stepId: EntityId;
  name: string;
  method: string;
  path: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  code?: number;
  duration?: number;
  timestamp?: string;
  message?: string;
}

// ─── API Endpoint (UI model — aligns with CanonicalApiModel) ────

export interface ApiEndpoint {
  id: EntityId;
  method: HttpMethod;
  path: string;
  summary: string;
  /** Longer description from the spec. */
  description?: string;
  coverage: number;
  cases: number;
  /** Tags from the OpenAPI spec, e.g. ["用户", "认证"]. */
  tags: string[];
  /** Whether this endpoint is marked deprecated in the spec. */
  deprecated: boolean;
  /** Which API version this endpoint belongs to. */
  versionId?: EntityId;
}

// ─── API Version ────────────────────────────────────────────────

/** A published, immutable API version created by importing an OpenAPI spec. */
export interface ApiVersionInfo {
  id: EntityId;
  /** Which ApiSource this version belongs to. */
  sourceId?: EntityId;
  /** Human-readable label, e.g. "openapi.yaml · v2.3.1". */
  label: string;
  /** Source type: openapi, raml, etc. */
  sourceType: 'openapi' | 'raml' | 'manual';
  /** Original file name. */
  fileName: string;
  /** Semantic version from the spec. */
  version: string;
  /** Number of endpoints in this version. */
  endpointCount: number;
  /** Number of schemas in this version. */
  schemaCount: number;
  /** When this version was imported. */
  importedAt: string;
  /** Whether this is the currently active version. */
  isActive: boolean;
}

// ─── API Source (系统) ───────────────────────────────────────────

/** A source system providing a set of API endpoints (e.g. "User Service", "Payment Service"). */
export interface ApiSource {
  id: EntityId;
  /** Display name, e.g. "用户服务". */
  name: string;
  description?: string;
  /** Original file or identifier, e.g. "user-service.yaml". */
  sourceLabel: string;
  sourceType: 'openapi' | 'raml' | 'manual';
  /** Default server URL for this source system. */
  defaultBaseUrl?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Endpoint Detail (aligned with canonical EndpointSchema) ────

export interface ApiParameter {
  id: string;
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required: boolean;
  deprecated: boolean;
  /** Schema type for simple parameters. */
  type?: string;
  /** Example value. */
  example?: string;
  /** Enum of allowed values. */
  enum?: string[];
}

export interface ApiRequestBody {
  id: string;
  description?: string;
  required: boolean;
  /** Media type → schema reference. */
  contentTypes: string[];
  /** Schema reference path, e.g. "/schemas/CreateUserRequest". */
  schemaRef?: string;
  /** Example body content — used for pasting sample request bodies. */
  exampleBody?: string;
}

export interface ApiResponseDef {
  id: string;
  statusCode: number;
  description: string;
  /** Media type → schema reference. */
  contentTypes: string[];
  /** Schema reference path. */
  schemaRef?: string;
}

export interface EndpointDetail {
  endpointId: EntityId;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  deprecated: boolean;
  tags: string[];
  parameters: ApiParameter[];
  requestBodies: ApiRequestBody[];
  responses: ApiResponseDef[];
  /** Security requirements, e.g. [{ "BearerAuth": [] }]. */
  security?: Record<string, string[]>[];
}

// ─── Schema Viewer ──────────────────────────────────────────────

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

export interface SchemaDisplayNode {
  /** Canonical path, e.g. "/schemas/User". */
  id: string;
  /** Human-readable name. */
  displayName: string;
  type?: JsonType;
  format?: string;
  description?: string;
  example?: unknown;
  nullable?: boolean;
  deprecated?: boolean;
  /** For string types. */
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: unknown[];
  /** For numeric types. */
  minimum?: number;
  maximum?: number;
  /** For array types. */
  items?: SchemaDisplayNode;
  /** For object types. */
  properties?: Record<string, SchemaDisplayNode>;
  required?: string[];
}

// ─── API Version Diff ───────────────────────────────────────────

export type ChangeType = 'added' | 'removed' | 'modified' | 'deprecated';

export interface ApiChangeItem {
  changeType: ChangeType;
  endpointId: EntityId;
  /** HTTP method + path for display. */
  path: string;
  /** Human-readable description of the change. */
  description: string;
  /** Whether this is a potentially breaking change. */
  breaking: boolean;
  /** Which test cases are affected. */
  affectedTestCases: number;
  /** Which workflows are affected. */
  affectedWorkflows: number;
}

export interface ApiVersionDiff {
  baseVersionId: EntityId;
  baseVersionLabel: string;
  targetVersionId: EntityId;
  targetVersionLabel: string;
  /** Summary counts. */
  summary: {
    addedEndpoints: number;
    removedEndpoints: number;
    modifiedEndpoints: number;
    breakingChanges: number;
  };
  /** All endpoint-level changes. */
  changes: ApiChangeItem[];
}

// ─── Test Case (UI model — aligns with TestDefinition) ──────────

/** Source of a test case: OpenAPI spec, AI Agent, or manual authoring. */
export type TestSource = 'OpenAPI' | 'AI Agent' | '手动';

/** Publication status. */
export type TestStatus = '已发布' | '待审核';

export interface TestCase {
  id: EntityId;
  name: string;
  endpoint: string;
  source: TestSource;
  status: TestStatus;
  lastRun: string;
}

// ─── Report Center: Run → Workflow Result → Step ─────────────

/** Aggregated status of an execution run. */
export type RunStatus = 'passed' | 'failed' | 'inconclusive' | 'infra-error';

/** What triggered the run. */
export type TriggerType = 'manual' | 'scheduled' | 'ci' | 'webhook';

/** Per-workflow outcome inside a run. */
export type WorkflowResultStatus = 'passed' | 'failed' | 'skipped' | 'error';

/** Step-level execution detail (same shape for both list-preview and full detail). */
export interface ReportStep {
  id: string;
  name: string;
  method: string;
  path: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  requestEvidence?: string;
  responseEvidence?: string;
  assertionFailure?: string;
  responseStatus?: number;
}

/** Outcome of a single workflow within an execution run. */
export interface WorkflowResult {
  workflowId: string;
  workflowName: string;
  bpId: string;
  status: WorkflowResultStatus;
  stepsPassed: number;
  stepsFailed: number;
  stepsSkipped: number;
  totalDurationMs: number;
  steps: ReportStep[];
}

/**
 * An execution run — the unit shown in the report list.
 * A run groups the results of multiple workflows executed together
 * according to a plan or tag selection.
 */
export interface RunMeta {
  id: string;
  runId: string;
  /** Human-readable label, e.g. "全量回归 · staging". */
  name: string;
  /** Which plan drove the selection (null for ad-hoc tag selections). */
  planId?: string;
  environment: string;
  trigger: TriggerType;
  status: RunStatus;
  totalWorkflows: number;
  workflowsPassed: number;
  workflowsFailed: number;
  workflowsSkipped: number;
  totalDurationMs: number;
  startedAt: string;
  finishedAt: string;
  /** Tags used for workflow selection. */
  selectedTags: string[];
  /** Workflow-level results. */
  workflows: WorkflowResult[];
  /* Traceability */
  gitCommit?: string;
  gitSha?: string;
  runnerVersion?: string;
  traceId?: string;
  openapiVersion?: string;
}

/** Predefined test plan for workflow subset selection. */
export interface TestPlan {
  id: string;
  name: string;
  description: string;
  /** 'all' = workflow must have ALL listed tags; 'any' = at least one. */
  tagFilter: 'all' | 'any';
  tags: string[];
  /** How many workflows this plan would select. */
  workflowCount: number;
}

// ─── Variable (UI model — aligns with VariableRef / contracts-common) ─

/** Supported variable types for the UI. */
export type VariableType = 'plain' | 'secret' | 'dataset';

/** A managed variable in the platform. */
export interface Variable {
  id: EntityId;
  /** Variable name (e.g. "userService", "accessToken"). */
  name: string;
  /** Default value — used when no environment is active, or as fallback. */
  defaultValue: string;
  /** Per-environment value overrides keyed by environment id. */
  overrides: Record<string, string>;
  /** Classification: plain variable, secret reference, or dataset. */
  type: VariableType;
  /** Scope: environment-global, workflow-scoped, or step-local. */
  scope: VariableScope;
  /** When scope is 'source', which ApiSource this variable belongs to. */
  sourceId?: EntityId;
  /** Whether this variable contains sensitive data (always true for secrets). */
  sensitive: boolean;
  /** Human-readable description. */
  description: string;
  /** ISO-8601 timestamp of last modification. */
  updatedAt: string;
  /** Who last modified this variable. */
  updatedBy: string;
  /** Which workflows reference this variable. */
  usedIn: string[];
}

// ─── Environment (UI model — aligns with EnvironmentSchema) ──────

/** A deployment target with its own variable values. */
export interface Environment {
  id: EntityId;
  name: string;
  description: string;
  /** Human-readable tags, e.g. ["production", "read-only"]. */
  tags: string[];
  /** Whether this is a production environment (triggers safety policies). */
  isProduction: boolean;
  /** ISO-8601 timestamp of last modification. */
  updatedAt: string;
  /** Who last modified this environment. */
  updatedBy: string;
}

/**
 * Resolve the effective value of a variable given the active environment.
 * Checks per-environment override first, then falls back to defaultValue.
 */
export function resolveVariableValue(
  variable: Variable,
  activeEnvironmentId: string | null,
): string {
  if (activeEnvironmentId && variable.overrides[activeEnvironmentId]) {
    return variable.overrides[activeEnvironmentId];
  }
  return variable.defaultValue;
}
