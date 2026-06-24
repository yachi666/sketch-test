/**
 * Workflow Compiler — transforms a WorkflowDefinition (editor DSL) into an ExecutionPlan.
 *
 * Responsibilities:
 * 1. Expand test references (fetch TestCaseVersion from DB, merge definitions).
 * 2. Validate variable references (all ${...} must be resolvable).
 * 3. Validate step dependencies (no forward references, detect cycles).
 * 4. Set explicit limits (maxRetries default 0, timeoutMs default 30000).
 * 5. Compile teardown phase into a separate phase marked for always-execution.
 * 6. Freeze all version references (replace testCaseVersionId with actual definitions).
 * 7. Produce diagnostic warnings for unresolved variables, missing tests, cycles, empty steps.
 */

import crypto from 'node:crypto';
import type { ExecutionPlan, FrozenStep, FrozenTeardownStep } from '@sketch-test/runner-protocol';

// ─── Editor DSL Types (what the web editor sends) ────────────────

export interface WorkflowStepDef {
  id: string;
  name: string;
  /** Reference to a published TestCaseVersion (e.g. "tcv_abc123"). */
  useTest?: string;
  /** Inline request fields (when useTest is not set). */
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Variable extractions. */
  extract?: Array<{
    name: string;
    source: string;
    expression: string;
    scope?: string;
  }>;
  /** Assertions. */
  assertions?: Array<{
    target: string;
    operator: string;
    expected?: unknown;
    description?: string;
  }>;
  /** Failure strategy. */
  onFailure?: string;
  /** Maximum retry count. */
  maxRetries?: number;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Whether this step is enabled. */
  enabled?: boolean;
  /** Side effect classification. */
  sideEffect?: string;
}

export interface TeardownStepDef {
  id: string;
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  maxRetries?: number;
  enabled?: boolean;
}

export interface WorkflowDefInput {
  schemaVersion?: string;
  name: string;
  steps: WorkflowStepDef[];
  teardown?: TeardownStepDef[];
}

// ─── Resolved Test Definition (from test_case_versions) ──────────

interface ResolvedTestDef {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  assertions: Array<{
    target: string;
    operator: string;
    expected?: unknown;
    description?: string;
  }>;
  extract?: Array<{
    name: string;
    source: string;
    expression: string;
    scope?: string;
  }>;
  sideEffect?: string;
}

// ─── Diagnostic Types ────────────────────────────────────────────

export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  stepId?: string;
}

export interface CompileResult {
  success: boolean;
  plan?: ExecutionPlan;
  diagnostics: CompileDiagnostic[];
}

export interface CompileOptions {
  /** Resolver function that fetches a TestCaseVersion definition by ID. */
  resolveTest?: (testVersionId: string) => Promise<ResolvedTestDef | null>;
}

// ─── Variable Reference Parsing ──────────────────────────────────

const VAR_REF_RE = /\$\{([^}]+)\}/g;

/**
 * Parse all variable references from a string.
 * Returns an array of { fullMatch, expression } where expression is the inner text.
 */
function extractVarRefs(text: string): { fullMatch: string; expression: string }[] {
  const refs: { fullMatch: string; expression: string }[] = [];
  const re = new RegExp(VAR_REF_RE.source, 'g');
  for (let match = re.exec(text); match !== null; match = re.exec(text)) {
    const expr = match[1];
    if (expr) {
      refs.push({ fullMatch: match[0], expression: expr });
    }
  }
  return refs;
}

/**
 * Extract variable references from any value (string, object, array).
 */
function extractVarRefsDeep(value: unknown): string[] {
  const expressions = new Set<string>();
  if (typeof value === 'string') {
    for (const ref of extractVarRefs(value)) {
      expressions.add(ref.expression);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      for (const expr of extractVarRefsDeep(item)) {
        expressions.add(expr);
      }
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [, v] of Object.entries(value as Record<string, unknown>)) {
      for (const expr of extractVarRefsDeep(v)) {
        expressions.add(expr);
      }
    }
  }
  return [...expressions];
}

/**
 * Classify a variable reference expression.
 * - "env.xxx" → { scope: 'environment', name: 'xxx' }
 * - "stepId.varName" or "varName" → { scope: 'workflow', name: 'varName' }
 */
function classifyVarRef(expression: string): { scope: string; name: string } {
  if (expression.startsWith('env.')) {
    return { scope: 'environment', name: expression.slice(4) };
  }
  // Could be "stepId.varName" or just "varName"
  const dotIndex = expression.indexOf('.');
  if (dotIndex > 0) {
    return { scope: 'step', name: expression };
  }
  return { scope: 'workflow', name: expression };
}

// ─── Step Dependency Analysis ────────────────────────────────────

interface StepVarInfo {
  stepId: string;
  /** Variable names this step produces (extracts). */
  produces: string[];
  /** Variable expressions this step references. */
  references: string[];
}

function analyzeStepVariables(steps: WorkflowStepDef[]): StepVarInfo[] {
  return steps.map((step) => {
    const produces = (step.extract ?? []).map((e) => e.name);
    const references = new Set<string>();

    // Extract refs from url
    if (step.url) {
      for (const expr of extractVarRefsDeep(step.url)) references.add(expr);
    }
    // Extract refs from headers
    if (step.headers) {
      for (const [, val] of Object.entries(step.headers)) {
        for (const expr of extractVarRefsDeep(val)) references.add(expr);
      }
    }
    // Extract refs from body
    if (step.body !== undefined) {
      for (const expr of extractVarRefsDeep(step.body)) references.add(expr);
    }

    return { stepId: step.id, produces, references: [...references] };
  });
}

/**
 * Check for forward references: if step B references a variable produced by step A,
 * step A must come before step B (lower index).
 */
function checkStepDependencies(steps: WorkflowStepDef[], diagnostics: CompileDiagnostic[]): void {
  const varInfo = analyzeStepVariables(steps);

  // Track step-scoped vars: "stepId.varName" → step index
  const stepScopedProduced: Map<string, number> = new Map();

  // Also collect workflow-scoped variable names and their producing step indices
  const workflowVarProducers: Map<string, number> = new Map();

  for (let i = 0; i < varInfo.length; i++) {
    const info = varInfo[i];
    if (!info) continue;
    for (const varName of info.produces) {
      workflowVarProducers.set(varName, i);
    }
    // Track step-scoped production: "${stepId}.varName" or "${stepId.varName}"
    stepScopedProduced.set(info.stepId, i);
  }

  // Now check each step's references
  for (let i = 0; i < varInfo.length; i++) {
    const info = varInfo[i];
    if (!info) continue;
    for (const ref of info.references) {
      const classified = classifyVarRef(ref);

      if (classified.scope === 'environment') {
        // Environment vars are always available — no ordering check needed
        continue;
      }

      if (classified.scope === 'step') {
        // Format: "stepId.varName"
        const parts = ref.split('.');
        const refStepId = parts[0];
        if (!refStepId) continue;
        const producerIndex = stepScopedProduced.get(refStepId);
        if (producerIndex !== undefined && producerIndex > i) {
          diagnostics.push({
            severity: 'error',
            message: `Step "${info.stepId}" references variable "${ref}" from step "${refStepId}" which executes after it (position ${producerIndex} > ${i})`,
            stepId: info.stepId,
          });
        }
        continue;
      }

      // Workflow-scoped variable
      const producerIndex = workflowVarProducers.get(ref);
      if (producerIndex !== undefined && producerIndex > i) {
        diagnostics.push({
          severity: 'error',
          message: `Step "${info.stepId}" references variable "${ref}" which is produced by a later step (position ${producerIndex} > ${i})`,
          stepId: info.stepId,
        });
      }
      if (producerIndex === undefined) {
        diagnostics.push({
          severity: 'warning',
          message: `Variable "${ref}" referenced by step "${info.stepId}" is not produced by any step — it may be an environment variable or unresolved`,
          stepId: info.stepId,
        });
      }
    }
  }
}

/**
 * Simple cycle detection using DFS.
 */
function detectCycles(steps: WorkflowStepDef[], diagnostics: CompileDiagnostic[]): void {
  const varInfo = analyzeStepVariables(steps);
  const stepIndex: Map<string, number> = new Map();
  for (let i = 0; i < steps.length; i++) {
    stepIndex.set(steps[i]!.id, i);
  }

  // Build adjacency: step A → step B if A references a variable produced by B
  const adj: Map<number, number[]> = new Map();
  const producedByStep: Map<string, string> = new Map(); // varName → stepId

  for (const info of varInfo) {
    for (const varName of info.produces) {
      producedByStep.set(varName, info.stepId);
    }
  }

  for (let i = 0; i < varInfo.length; i++) {
    const info = varInfo[i];
    if (!info) continue;
    const deps: number[] = [];
    for (const ref of info.references) {
      const classified = classifyVarRef(ref);
      if (classified.scope === 'environment') continue;

      let producerStepId: string | undefined;
      if (classified.scope === 'step') {
        producerStepId = ref.split('.')[0];
      } else {
        producerStepId = producedByStep.get(ref);
      }

      if (producerStepId) {
        const producerIdx = stepIndex.get(producerStepId);
        if (producerIdx !== undefined) {
          deps.push(producerIdx);
        }
      }
    }
    adj.set(i, deps);
  }

  // DFS for cycles
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Array(steps.length).fill(WHITE);

  function dfs(u: number): boolean {
    color[u] = GRAY;
    for (const v of adj.get(u) ?? []) {
      if (color[v] === GRAY) {
        const stepU = steps[u];
        const stepV = steps[v];
        diagnostics.push({
          severity: 'error',
          message: `Cycle detected involving step "${stepU?.id ?? 'unknown'}" and step "${stepV?.id ?? 'unknown'}"`,
          stepId: stepU?.id,
        });
        return true;
      }
      if (color[v] === WHITE && dfs(v)) {
        return true;
      }
    }
    color[u] = BLACK;
    return false;
  }

  for (let i = 0; i < steps.length; i++) {
    if (color[i] === WHITE) {
      dfs(i);
    }
  }
}

// ─── Test Reference Resolution ───────────────────────────────────

async function resolveStepDefinition(
  step: WorkflowStepDef,
  resolveTest: ((testVersionId: string) => Promise<ResolvedTestDef | null>) | undefined,
  diagnostics: CompileDiagnostic[],
): Promise<ResolvedTestDef | null> {
  // If the step uses a test reference
  if (step.useTest) {
    if (!resolveTest) {
      diagnostics.push({
        severity: 'warning',
        message: `Step "${step.id}" references test "${step.useTest}" but no resolver is available — test will not be expanded`,
        stepId: step.id,
      });
      // Fall back to inline fields if present, otherwise return null
      if (step.method) {
        return {
          method: step.method,
          url: step.url ?? '',
          headers: step.headers,
          body: step.body,
          assertions: (step.assertions ?? []).map((a) => ({
            target: a.target,
            operator: a.operator,
            expected: a.expected,
            description: a.description,
          })),
          extract: step.extract,
          sideEffect: step.sideEffect,
        };
      }
      return null;
    }

    const testDef = await resolveTest(step.useTest);
    if (!testDef) {
      diagnostics.push({
        severity: 'error',
        message: `Step "${step.id}" references test "${step.useTest}" which was not found`,
        stepId: step.id,
      });
      return null;
    }

    // Merge: test definition provides the base, step-level overrides take precedence
    return {
      method: step.method ?? testDef.method,
      url: step.url ?? testDef.url,
      headers: step.headers ?? testDef.headers,
      body: step.body !== undefined ? step.body : testDef.body,
      assertions: (step.assertions ?? testDef.assertions).map((a) => ({
        target: a.target,
        operator: a.operator,
        expected: a.expected,
        description: a.description,
      })),
      extract: step.extract ?? testDef.extract,
      sideEffect: step.sideEffect ?? testDef.sideEffect,
    };
  }

  // Inline step
  if (!step.method) {
    diagnostics.push({
      severity: 'error',
      message: `Step "${step.id}" has no method — either useTest or method is required`,
      stepId: step.id,
    });
    return null;
  }

  return {
    method: step.method,
    url: step.url ?? '',
    headers: step.headers,
    body: step.body,
    assertions: (step.assertions ?? []).map((a) => ({
      target: a.target,
      operator: a.operator,
      expected: a.expected,
      description: a.description,
    })),
    extract: step.extract,
    sideEffect: step.sideEffect,
  };
}

// ─── Main Compiler ───────────────────────────────────────────────

const VALID_ON_FAILURE = ['stop', 'skip', 'teardown-and-stop'] as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 0;

function makePlanHash(steps: FrozenStep[], teardown?: FrozenTeardownStep[]): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({ steps, teardown }));
  return hash.digest('hex');
}

/**
 * Compile a WorkflowDefinition (editor DSL) into an ExecutionPlan.
 *
 * @param definition - The workflow definition from the editor.
 * @param options.resolveTest - Optional async function to resolve TestCaseVersion IDs.
 * @returns CompileResult with the compiled plan and diagnostics.
 */
export async function compileWorkflow(
  definition: WorkflowDefInput,
  options?: CompileOptions,
): Promise<CompileResult> {
  const diagnostics: CompileDiagnostic[] = [];

  // ── Validate basic structure ──────────────────────────────────
  if (!definition.steps || definition.steps.length === 0) {
    diagnostics.push({
      severity: 'error',
      message: 'Workflow must have at least one step',
    });
    return { success: false, diagnostics };
  }

  if (definition.steps.length > 50) {
    diagnostics.push({
      severity: 'error',
      message: `Workflow has ${definition.steps.length} steps; maximum is 50`,
    });
    return { success: false, diagnostics };
  }

  // Check for duplicate step IDs
  const stepIds = new Set<string>();
  for (const step of definition.steps) {
    if (stepIds.has(step.id)) {
      diagnostics.push({
        severity: 'error',
        message: `Duplicate step ID: "${step.id}"`,
        stepId: step.id,
      });
    }
    stepIds.add(step.id);
  }

  if (definition.teardown && definition.teardown.length > 20) {
    diagnostics.push({
      severity: 'error',
      message: `Teardown has ${definition.teardown.length} steps; maximum is 20`,
    });
  }

  // Check for empty steps (no useTest and no inline method)
  for (const step of definition.steps) {
    if (!step.useTest && !step.method) {
      diagnostics.push({
        severity: 'error',
        message: `Step "${step.id}" has neither useTest nor method — it will do nothing`,
        stepId: step.id,
      });
    }
  }

  // ── Validate variable references ──────────────────────────────
  checkStepDependencies(definition.steps, diagnostics);

  // ── Detect cycles ─────────────────────────────────────────────
  detectCycles(definition.steps, diagnostics);

  // ── Collect all unique variable references for unused-var warnings ──
  const allRefs = new Set<string>();
  const allProduced = new Set<string>();
  for (const step of definition.steps) {
    for (const e of step.extract ?? []) {
      allProduced.add(e.name);
    }
    for (const expr of [
      ...extractVarRefsDeep(step.url),
      ...extractVarRefsDeep(step.headers),
      ...extractVarRefsDeep(step.body),
    ]) {
      const classified = classifyVarRef(expr);
      if (classified.scope === 'workflow') {
        allRefs.add(expr);
      }
    }
  }

  // ── Resolve steps ─────────────────────────────────────────────
  const resolvedSteps: Array<{ def: ResolvedTestDef; step: WorkflowStepDef }> = [];
  let hasErrors = false;

  for (const step of definition.steps) {
    const resolved = await resolveStepDefinition(step, options?.resolveTest, diagnostics);
    if (!resolved) {
      hasErrors = true;
      continue;
    }
    resolvedSteps.push({ def: resolved, step });
  }

  // ── Check for unresolved variables across all resolved steps ──
  if (options?.resolveTest === undefined && definition.steps.some((s) => s.useTest)) {
    diagnostics.push({
      severity: 'warning',
      message:
        'Some steps reference test versions but no resolver is available — compiling with inline data only',
    });
  }

  // ── Stop if there are errors ──────────────────────────────────
  const hasFatalErrors = diagnostics.some((d) => d.severity === 'error');
  if (hasFatalErrors || hasErrors) {
    return { success: false, diagnostics };
  }

  // ── Build FrozenSteps ─────────────────────────────────────────
  const planId = `plan_${crypto.randomBytes(4).toString('hex')}`;
  const frozenSteps: FrozenStep[] = [];

  for (let i = 0; i < resolvedSteps.length; i++) {
    const entry = resolvedSteps[i];
    if (!entry) continue;
    const { def, step } = entry;
    const onFailure = VALID_ON_FAILURE.includes(step.onFailure as (typeof VALID_ON_FAILURE)[number])
      ? (step.onFailure as 'stop' | 'skip' | 'teardown-and-stop')
      : 'stop';
    const maxRetries = step.maxRetries ?? DEFAULT_MAX_RETRIES;
    const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const enabled = step.enabled !== undefined ? step.enabled : true;

    frozenSteps.push({
      stepId: step.id,
      sequence: i,
      method: def.method as FrozenStep['method'],
      urlTemplate: def.url,
      headers: def.headers,
      body: def.body,
      maxRetries: Math.min(maxRetries, 10),
      retryBaseDelayMs: 1000,
      retryBackoffMultiplier: 2,
      retryOnNetworkError: true,
      onFailure,
      assertions: def.assertions.map((a, ai) => ({
        id: `${planId}-assert-${i}-${ai}`,
        description: a.description,
        target: (a.target as FrozenStep['assertions'][0]['target']) || 'status',
        operator: (a.operator as FrozenStep['assertions'][0]['operator']) || 'equals',
        expected: a.expected,
        severity: 'block' as const,
      })),
      extractions: (def.extract ?? []).map((e) => ({
        name: e.name,
        source: (e.source as 'body' | 'header' | 'cookie' | 'status') || 'body',
        expression: e.expression,
        scope: (e.scope as 'step' | 'workflow') || 'workflow',
        sensitive: false,
      })),
      sideEffect: (def.sideEffect as FrozenStep['sideEffect']) || 'read-only',
      enabled,
      timeoutMs: Math.min(timeoutMs, 300_000),
      originTestVersionId: step.useTest,
    });
  }

  // ── Build Teardown Steps ──────────────────────────────────────
  let frozenTeardown: FrozenTeardownStep[] | undefined;
  if (definition.teardown && definition.teardown.length > 0) {
    frozenTeardown = definition.teardown.map((td, i) => ({
      stepId: td.id,
      sequence: i,
      method: td.method as FrozenTeardownStep['method'],
      urlTemplate: td.url,
      headers: td.headers,
      body: td.body,
      assertions: [],
      extractions: [],
      sideEffect: 'cleanup-required' as const,
      enabled: td.enabled !== undefined ? td.enabled : true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: Math.min(td.maxRetries ?? 1, 3),
      originTestVersionId: undefined,
      originContentHash: undefined,
    }));
  }

  // ── Build ExecutionPlan ───────────────────────────────────────
  const planHash = makePlanHash(frozenSteps, frozenTeardown);
  const now = new Date().toISOString();

  const plan: ExecutionPlan = {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId,
    planHash,
    workflowVersionId: '', // Will be set by the service when publishing
    compiledAt: now,
    steps: frozenSteps,
    teardown: frozenTeardown
      ? {
          strategy: 'always',
          steps: frozenTeardown,
        }
      : undefined,
  };

  // Add diagnostic warnings for extractions without assertions (informational)
  for (const step of definition.steps) {
    const hasExtract = step.extract && step.extract.length > 0;
    const hasAssertions = step.assertions && step.assertions.length > 0;
    if (hasExtract && !hasAssertions && !step.useTest) {
      diagnostics.push({
        severity: 'warning',
        message: `Step "${step.id}" has variable extractions but no assertions — consider adding assertions to verify the response`,
        stepId: step.id,
      });
    }
  }

  return { success: true, plan, diagnostics };
}
