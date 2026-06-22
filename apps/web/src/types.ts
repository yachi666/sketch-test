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
  coverage: number;
  cases: number;
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

// ─── Variable (UI model — aligns with VariableRef / contracts-common) ─

/** Supported variable types for the UI. */
export type VariableType = 'plain' | 'secret' | 'dataset';

/** A managed variable in the platform. */
export interface Variable {
  id: EntityId;
  /** Variable name (e.g. "baseUrl", "accessToken"). */
  name: string;
  /** Current value. Masked in UI for secret-typed variables. */
  value: string;
  /** Classification: plain variable, secret reference, or dataset. */
  type: VariableType;
  /** Scope: environment-global, workflow-scoped, or step-local. */
  scope: VariableScope;
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
