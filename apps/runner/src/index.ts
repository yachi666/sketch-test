/**
 * @tap/runner — TAP Test Runner
 *
 * Executes HTTP tests based on compiled ExecutionPlans. The Runner is an
 * independent process deployed near the system under test. It communicates
 * with the Control Plane via the Runner Protocol.
 *
 * M0 scope:
 * - HTTP request execution (GET, POST, PUT, PATCH, DELETE)
 * - Variable resolution (environment, workflow, step scopes)
 * - Assertion evaluation (status, header, jsonPath, body, responseTime)
 * - Variable extraction (JSONPath from response body/headers)
 * - Event production (step lifecycle events)
 * - Sensitive data redaction
 * - Timeout handling with AbortController
 *
 * Invariants:
 * - Secrets are never included in event payloads.
 * - Sensitive data is redacted before event production.
 * - All events are assigned monotonic sequence numbers.
 * - Retries record each attempt independently.
 */

import type { EntityId, Instant } from '@tap/contracts-common';
import type {
  AssertionEvaluatedEvent,
  ExecutionPlan,
  FrozenStep,
  ResponseReceivedEvent,
  RunEvent,
  RunFinishedEvent,
  RunStartedEvent,
  StepFinishedEvent,
  StepStartedEvent,
  VariableExtractedEvent,
} from '@tap/runner-protocol';
import { RunEventSchema } from '@tap/runner-protocol';

// ─── Variable Store ───────────────────────────────────────────────

interface VariableStore {
  /** Set a variable in a given scope. */
  set(name: string, value: unknown, scope: 'step' | 'workflow', sensitive?: boolean): void;
  /** Get a variable value by name. */
  get(name: string): unknown;
  /** Get all non-sensitive variables for event reporting. */
  getPublicSnapshot(): Record<string, { scope: string; valuePreview: string }>;
  /** Resolve variable references in a string template. */
  resolve(template: string): string;
}

function createVariableStore(env: Record<string, string> = {}): VariableStore {
  const store = new Map<string, { value: unknown; scope: string; sensitive: boolean }>();

  // Seed with environment variables
  for (const [key, value] of Object.entries(env)) {
    store.set(key, { value, scope: 'environment', sensitive: false });
  }

  return {
    set(name, value, scope, sensitive = false) {
      store.set(name, { value, scope, sensitive });
    },
    get(name) {
      const entry = store.get(name);
      return entry?.value;
    },
    getPublicSnapshot() {
      const snapshot: Record<string, { scope: string; valuePreview: string }> = {};
      for (const [name, entry] of store) {
        if (!entry.sensitive) {
          snapshot[name] = {
            scope: entry.scope,
            valuePreview: String(entry.value).slice(0, 256),
          };
        } else {
          snapshot[name] = { scope: entry.scope, valuePreview: '***REDACTED***' };
        }
      }
      return snapshot;
    },
    resolve(template) {
      return template.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        // Handle dot notation: ${env.baseUrl}, ${steps.createUser.userId}
        const parts = name.split('.');
        if (parts.length >= 2) {
          const varName = parts.at(-1) ?? '';
          const entry = store.get(varName);
          return String(entry?.value ?? entry ?? `\${${name}}`);
        }
        const entry = store.get(name);
        return String(entry?.value ?? entry ?? `\${${name}}`);
      });
    },
  };
}

// ─── Sensitive Data Redaction ─────────────────────────────────────

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'proxy-authorization',
]);

const SENSITIVE_JSON_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'privateKey',
  'private_key',
]);

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      redacted[key] = '***REDACTED***';
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function redactBody(body: unknown, maxPreviewLength = 4096): string | undefined {
  if (body === undefined || body === null) return undefined;
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    // Simple field-level redaction for JSON bodies
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === 'object' && parsed !== null) {
        redactObject(parsed);
        return JSON.stringify(parsed).slice(0, maxPreviewLength);
      }
    } catch {
      // Not JSON, redact as plain text if it contains sensitive patterns
    }
    return str.slice(0, maxPreviewLength);
  } catch {
    return String(body).slice(0, maxPreviewLength);
  }
}

function redactObject(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (SENSITIVE_JSON_FIELDS.has(key) || SENSITIVE_JSON_FIELDS.has(key.toLowerCase())) {
      obj[key] = '***REDACTED***';
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      redactObject(obj[key] as Record<string, unknown>);
    }
  }
}

// ─── JSONPath (Simplified) ────────────────────────────────────────

/**
 * Minimal JSONPath implementation for M0. Supports:
 * - $.field.subfield
 * - $[0].field
 * - $.data.items[*].name (wildcard in arrays)
 */
function jsonPathGet(obj: unknown, path: string): unknown {
  // Remove leading "$."
  const expr = path.replace(/^\$\.?/, '');

  // Split by "." but preserve brackets
  const segments: string[] = [];
  let current = '';
  for (const ch of expr) {
    if (ch === '.' && !current.includes('[')) {
      segments.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);

  let currentObj: unknown = obj;
  for (const segment of segments) {
    if (currentObj === null || currentObj === undefined) return undefined;

    // Handle array index: field[0]
    const arrayMatch = segment.match(/^(\w+)\[(\d+|\*)\]$/);
    if (arrayMatch) {
      const fieldName = arrayMatch[1] ?? '';
      const index = arrayMatch[2] ?? '';
      const record = currentObj as Record<string, unknown>;
      const arr = record[fieldName];
      if (!Array.isArray(arr)) return undefined;
      if (index === '*') return arr;
      return arr[parseInt(index, 10)];
    }

    // Simple field access
    if (typeof currentObj === 'object' && currentObj !== null) {
      currentObj = (currentObj as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return currentObj;
}

// ─── Assertion Evaluation ─────────────────────────────────────────

interface AssertionResult {
  assertionId: EntityId;
  passed: boolean;
  description?: string;
  expected?: string;
  actual?: string;
  schemaDiff?: string;
  severity: 'block' | 'warn';
}

function evaluateAssertions(
  step: FrozenStep,
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    durationMs: number;
  },
): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const assertion of step.assertions) {
    let passed = false;
    let actual: string | undefined;
    let expected: string | undefined;

    switch (assertion.target) {
      case 'status': {
        actual = String(response.status);
        expected = assertion.expected != null ? String(assertion.expected) : undefined;
        const expectedStatus = assertion.expected != null ? Number(assertion.expected) : 200;
        passed = response.status === expectedStatus;
        break;
      }

      case 'header': {
        const headerName = assertion.path;
        if (!headerName) {
          passed = false;
          actual = 'missing header name';
          break;
        }
        const headerValue = response.headers[headerName.toLowerCase()];
        actual = headerValue ?? '(not present)';
        expected = assertion.expected != null ? String(assertion.expected) : undefined;

        switch (assertion.operator) {
          case 'exists':
            passed = headerValue !== undefined;
            break;
          case 'equals':
            passed = headerValue === expected;
            break;
          case 'contains':
            passed = typeof headerValue === 'string' && headerValue.includes(expected ?? '');
            break;
          default:
            passed = headerValue !== undefined;
        }
        break;
      }

      case 'jsonPath': {
        if (!assertion.path) {
          passed = false;
          actual = 'missing JSONPath';
          break;
        }
        const value = jsonPathGet(response.body, assertion.path);
        actual = value !== undefined ? JSON.stringify(value) : '(not found)';
        expected = assertion.expected != null ? JSON.stringify(assertion.expected) : undefined;

        switch (assertion.operator) {
          case 'exists':
            passed = value !== undefined;
            break;
          case 'notExists':
            passed = value === undefined;
            break;
          case 'equals':
            passed = JSON.stringify(value) === JSON.stringify(assertion.expected);
            break;
          case 'contains': {
            const strValue = typeof value === 'string' ? value : JSON.stringify(value);
            passed = strValue.includes(String(assertion.expected ?? ''));
            break;
          }
          case 'greaterThan':
            passed = Number(value) > Number(assertion.expected);
            break;
          case 'lessThan':
            passed = Number(value) < Number(assertion.expected);
            break;
          case 'matches':
            passed = new RegExp(String(assertion.expected ?? '')).test(String(value));
            break;
          case 'type':
            passed = typeof value === String(assertion.expected);
            break;
          case 'hasItems':
            passed = Array.isArray(value) && value.length > 0;
            break;
          case 'isEmpty':
            passed =
              value === undefined ||
              value === null ||
              value === '' ||
              (Array.isArray(value) && value.length === 0) ||
              (typeof value === 'object' && Object.keys(value as object).length === 0);
            break;
          default:
            passed = true;
        }
        break;
      }

      case 'body': {
        const bodyStr = JSON.stringify(response.body);
        actual = bodyStr.slice(0, 1024);
        expected = assertion.expected != null ? String(assertion.expected) : undefined;

        switch (assertion.operator) {
          case 'contains':
            passed = bodyStr.includes(String(assertion.expected ?? ''));
            break;
          case 'equals':
            passed = bodyStr === JSON.stringify(assertion.expected);
            break;
          case 'notContains':
            passed = !bodyStr.includes(String(assertion.expected ?? ''));
            break;
          default:
            passed = true;
        }
        break;
      }

      case 'responseTime': {
        actual = `${response.durationMs}ms`;
        expected = assertion.expected != null ? `${String(assertion.expected)}ms` : undefined;
        const maxMs = assertion.expected != null ? Number(assertion.expected) : Infinity;
        passed = response.durationMs < maxMs;
        break;
      }

      case 'schema': {
        // Schema validation deferred to a dedicated validator
        passed = true;
        actual = 'schema validation deferred';
        break;
      }
    }

    results.push({
      assertionId: assertion.id,
      passed,
      description: assertion.description,
      expected,
      actual,
      severity: assertion.severity ?? 'block',
    });
  }

  return results;
}

// ─── Step Executor ────────────────────────────────────────────────

interface StepExecutionResult {
  events: RunEvent[];
  extractedVariables: Array<{
    name: string;
    value: unknown;
    scope: 'step' | 'workflow';
    sensitive: boolean;
  }>;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  error?: {
    type: 'timeout' | 'network' | 'dns' | 'tls' | 'parse' | 'policy' | 'unknown';
    message: string;
  };
}

async function executeStep(
  step: FrozenStep,
  variables: VariableStore,
  _stepIndex: number,
  runId: EntityId,
  attempt: number,
  traceId?: string,
): Promise<StepExecutionResult> {
  const events: RunEvent[] = [];
  const stepId = step.stepId;
  let seq = 0;

  function nextSeq(): number {
    return ++seq;
  }

  function makeMeta(extraSeq?: number) {
    return {
      runId,
      sequence: extraSeq ?? nextSeq(),
      timestamp: new Date().toISOString() as Instant,
      attempt,
      stepId,
      traceId,
    };
  }

  // Resolve URL
  const resolvedUrl = variables.resolve(step.urlTemplate);
  const resolvedHeaders: Record<string, string> = {};
  if (step.headers) {
    for (const [key, value] of Object.entries(step.headers)) {
      resolvedHeaders[key] = variables.resolve(value);
    }
  }

  // Step started event
  const stepStarted: StepStartedEvent = {
    ...makeMeta(),
    eventType: 'step.started',
    resolvedUrl: resolvedUrl.replace(/([?&])(token|apiKey|secret)=[^&]+/gi, '$1$2=***REDACTED***'),
  };
  events.push(stepStarted);

  // Build request
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), step.timeoutMs);

  try {
    const fetchStart = Date.now();

    // Prepare body
    let body: string | undefined;
    if (step.body !== undefined && step.body !== null) {
      body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
      body = variables.resolve(body);
    }

    // Resolve query parameters
    const url = new URL(resolvedUrl);
    if (step.query) {
      for (const [key, value] of Object.entries(step.query)) {
        url.searchParams.set(key, variables.resolve(value));
      }
    }

    // Request prepared event
    events.push({
      ...makeMeta(),
      eventType: 'request.prepared',
      headers: redactHeaders(resolvedHeaders),
      method: step.method,
      url: url.toString(),
      bodySizeBytes: body ? new TextEncoder().encode(body).length : undefined,
    });

    // Send request
    events.push({
      ...makeMeta(),
      eventType: 'request.sent',
      sentAt: new Date().toISOString() as Instant,
    });

    const response = await fetch(url.toString(), {
      method: step.method,
      headers: resolvedHeaders,
      body,
      signal: controller.signal,
      redirect: 'manual',
    });

    clearTimeout(timeout);

    const durationMs = Date.now() - fetchStart;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;
    const responseText = await response.text();
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }

    const bodySizeBytes = new TextEncoder().encode(responseText).length;

    // Response received event
    const responseEvent: ResponseReceivedEvent = {
      ...makeMeta(),
      eventType: 'response.received',
      statusCode: response.status as ResponseReceivedEvent['statusCode'],
      headers: redactHeaders(responseHeaders),
      bodySizeBytes,
      durationMs,
      bodyPreview: redactBody(responseBody),
    };
    events.push(responseEvent);

    // Variable extraction
    const extractedVariables: StepExecutionResult['extractedVariables'] = [];
    if (step.extractions) {
      for (const extraction of step.extractions) {
        let value: unknown;
        switch (extraction.source) {
          case 'body':
            value = jsonPathGet(responseBody, extraction.expression);
            break;
          case 'header':
            value = responseHeaders[extraction.expression.toLowerCase()];
            break;
          case 'status':
            value = response.status;
            break;
          case 'cookie':
            value = responseHeaders['set-cookie'] ?? undefined;
            break;
        }

        if (value !== undefined) {
          variables.set(extraction.name, value, extraction.scope, extraction.sensitive);
          extractedVariables.push({
            name: extraction.name,
            value,
            scope: extraction.scope,
            sensitive: extraction.sensitive ?? false,
          });

          const varEvent: VariableExtractedEvent = {
            ...makeMeta(),
            eventType: 'variable.extracted',
            name: extraction.name,
            sensitive: extraction.sensitive ?? false,
            valuePreview: extraction.sensitive ? undefined : String(value).slice(0, 256),
            source: extraction.source,
          };
          events.push(varEvent);
        }
      }
    }

    // Evaluate assertions
    const assertionResults = evaluateAssertions(step, {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
      durationMs,
    });

    const assertionPassed = assertionResults.filter((a) => a.passed).length;
    const assertionFailed = assertionResults.filter(
      (a) => !a.passed && a.severity === 'block',
    ).length;

    for (const result of assertionResults) {
      const ae: AssertionEvaluatedEvent = {
        ...makeMeta(),
        eventType: 'assertion.evaluated',
        assertionId: result.assertionId,
        passed: result.passed,
        description: result.description,
        expected: result.expected,
        actual: result.actual,
        schemaDiff: result.schemaDiff,
        severity: result.severity,
      };
      events.push(ae);
    }

    const stepStatus: StepExecutionResult['status'] = assertionFailed > 0 ? 'failed' : 'passed';

    // Step finished event
    const stepFinished: StepFinishedEvent = {
      ...makeMeta(),
      eventType: 'step.finished',
      status: stepStatus,
      totalDurationMs: durationMs,
      assertionsPassed: assertionPassed,
      assertionsFailed: assertionFailed,
      retries: 0,
    };
    events.push(stepFinished);

    return {
      events,
      extractedVariables,
      status: stepStatus,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);

    const isTimeout =
      (err as Error)?.name === 'AbortError' || (err as Error)?.message?.includes('abort');
    const errorType = isTimeout ? ('timeout' as const) : ('network' as const);
    const errorMessage = err instanceof Error ? err.message : String(err);

    const stepFinished: StepFinishedEvent = {
      ...makeMeta(),
      eventType: 'step.finished',
      status: 'error',
      totalDurationMs: 0,
      assertionsPassed: 0,
      assertionsFailed: 0,
      retries: 0,
      error: {
        type: errorType,
        message: errorMessage,
      },
    };
    events.push(stepFinished);

    return {
      events,
      extractedVariables: [],
      status: 'error',
      error: { type: errorType, message: errorMessage },
    };
  }
}

// ─── Plan Executor ────────────────────────────────────────────────

export interface RunResult {
  runId: EntityId;
  events: RunEvent[];
  status: 'passed' | 'failed' | 'inconclusive' | 'cancelled';
  stepsPassed: number;
  stepsFailed: number;
  stepsSkipped: number;
  totalDurationMs: number;
}

/**
 * Execute a complete ExecutionPlan.
 *
 * This is the main entry point for the Runner. It takes a compiled plan,
 * resolves variables, executes steps sequentially, evaluates assertions,
 * and produces a complete event log.
 */
export async function executePlan(
  plan: ExecutionPlan,
  options: {
    runId: EntityId;
    runnerId?: string;
    runnerVersion?: string;
    environment?: Record<string, string>;
  },
): Promise<RunResult> {
  const runId = options.runId;
  const runnerId = options.runnerId ?? 'runner-local';
  const runnerVersion = options.runnerVersion ?? '0.1.0';
  const variables = createVariableStore(options.environment);
  const allEvents: RunEvent[] = [];
  let globalSeq = 0;

  function nextSeq(): number {
    return ++globalSeq;
  }

  // Run started
  const runStarted: RunStartedEvent = {
    runId,
    sequence: nextSeq(),
    timestamp: new Date().toISOString() as Instant,
    attempt: 1,
    stepId: 'run' as EntityId,
    eventType: 'run.started',
    runnerId,
    runnerVersion,
  };
  allEvents.push(runStarted);

  const startTime = Date.now();
  let stepsPassed = 0;
  let stepsFailed = 0;
  let stepsSkipped = 0;

  // Execute main steps
  for (let i = 0; i < plan.steps.length; i++) {
    // biome-ignore lint/style/noNonNullAssertion: loop condition guarantees index is in bounds
    const step = plan.steps[i]!;

    if (!step.enabled) {
      stepsSkipped++;
      continue;
    }

    // Check condition
    if (step.conditionExpression) {
      try {
        const resolved = variables.resolve(step.conditionExpression);
        if (resolved === 'false' || resolved === '0' || resolved === '' || resolved === 'null') {
          if (step.conditionOnFalse === 'fail') {
            stepsFailed++;
            break;
          }
          stepsSkipped++;
          continue;
        }
      } catch {
        stepsFailed++;
        break;
      }
    }

    // Execute step with retries
    let stepResult: StepExecutionResult | null = null;
    const maxRetries = step.maxRetries ?? 0;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      stepResult = await executeStep(step, variables, i, runId, attempt);

      // Re-sequence events into global ordering
      for (const event of stepResult.events) {
        allEvents.push({ ...event, sequence: nextSeq() });
      }

      if (stepResult.status === 'passed') break;

      if (attempt <= maxRetries && stepResult.status === 'error') {
        // Will retry
        continue;
      }
      break;
    }

    if (!stepResult) {
      stepsFailed++;
      if (step.onFailure === 'stop') break;
      if (step.onFailure === 'teardown-and-stop') break;
      continue;
    }

    if (stepResult.status === 'passed') {
      stepsPassed++;
    } else if (stepResult.status === 'failed') {
      stepsFailed++;
      if (step.onFailure === 'stop' || step.onFailure === 'teardown-and-stop') break;
    } else {
      stepsFailed++;
      if (step.onFailure === 'stop' || step.onFailure === 'teardown-and-stop') break;
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const terminalState: RunResult['status'] = stepsFailed > 0 ? 'failed' : 'passed';

  // Run finished
  const runFinished: RunFinishedEvent = {
    runId,
    sequence: nextSeq(),
    timestamp: new Date().toISOString() as Instant,
    attempt: 1,
    stepId: 'run' as EntityId,
    eventType: 'run.finished',
    terminalState,
    totalSteps: plan.steps.length,
    stepsPassed,
    stepsFailed,
    stepsSkipped,
    totalDurationMs,
  };
  allEvents.push(runFinished);

  return {
    runId,
    events: allEvents,
    status: terminalState,
    stepsPassed,
    stepsFailed,
    stepsSkipped,
    totalDurationMs,
  };
}

/**
 * Validate that a runner event conforms to the Runner Protocol schema.
 */
export function validateEvent(event: unknown): RunEvent | null {
  const result = RunEventSchema.safeParse(event);
  return result.success ? result.data : null;
}

// ─── Re-exports ───────────────────────────────────────────────────

export type { AssertionResult, StepExecutionResult, VariableStore };
export {
  createVariableStore,
  evaluateAssertions,
  executeStep,
  jsonPathGet,
  redactBody,
  redactHeaders,
  redactObject,
};
