/**
 * @sketch-test/runner — SketchTest Test Runner
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

import type { EntityId, Instant } from '@sketch-test/contracts-common';
import type {
  AssertionEvaluatedEvent,
  ExecutionPlan,
  FrozenStep,
  FrozenTeardownStep,
  ResponseReceivedEvent,
  RunEvent,
  RunFinishedEvent,
  RunStartedEvent,
  StepFinishedEvent,
  StepRetriedEvent,
  StepStartedEvent,
  VariableExtractedEvent,
} from '@sketch-test/runner-protocol';
import { RunEventSchema } from '@sketch-test/runner-protocol';

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
  // Object body — redactObject returns a copy (body is shared with assertion code downstream).
  if (typeof body === 'object') {
    const redacted = redactObject(body);
    return JSON.stringify(redacted).slice(0, maxPreviewLength);
  }
  // String body — parse, redact in place (freshly parsed, no other references), stringify.
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === 'object' && parsed !== null) {
        redactObjectInPlace(parsed);
        return JSON.stringify(parsed).slice(0, maxPreviewLength);
      }
    } catch {
      // Not JSON, return as-is.
    }
    return body.slice(0, maxPreviewLength);
  }
  return String(body).slice(0, maxPreviewLength);
}

/** Mutate obj in place, redacting sensitive fields. Only safe when obj is not shared. */
function redactObjectInPlace(obj: unknown): void {
  if (Array.isArray(obj)) {
    for (const item of obj) redactObjectInPlace(item);
    return;
  }
  if (typeof obj !== 'object' || obj === null) return;
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SENSITIVE_JSON_FIELDS.has(key) || SENSITIVE_JSON_FIELDS.has(key.toLowerCase())) {
      record[key] = '***REDACTED***';
    } else {
      const val = record[key];
      if (typeof val === 'object' && val !== null) {
        redactObjectInPlace(val);
      }
    }
  }
}

function redactObject(obj: unknown): unknown {
  // Preserve array structure — Object.keys on arrays would convert them to plain objects.
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item));
  }
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  const input = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (SENSITIVE_JSON_FIELDS.has(key) || SENSITIVE_JSON_FIELDS.has(key.toLowerCase())) {
      result[key] = '***REDACTED***';
    } else {
      const val = input[key];
      // Only recurse into objects/arrays — primitives pass through directly.
      if (typeof val === 'object' && val !== null) {
        result[key] = redactObject(val);
      } else {
        result[key] = val;
      }
    }
  }
  return result;
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
    // ── Polling loop ─────────────────────────────────────────────
    const pollIntervalMs = step.pollIntervalMs ?? 1000;
    const pollMaxDurationMs = step.pollMaxDurationMs ?? 0;
    const pollMaxAttempts = step.pollMaxAttempts ?? 1;
    const pollStart = Date.now();
    let response: Response | null = null;
    let responseBody: unknown;
    let responseHeaders: Record<string, string> = {};
    let durationMs = 0;
    let bodySizeBytes = 0;
    let resolvedUrlWithParams = resolvedUrl;

    for (let pollAttempt = 1; pollAttempt <= pollMaxAttempts; pollAttempt++) {
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
      resolvedUrlWithParams = url.toString();

      // Request prepared event (only on first attempt)
      if (pollAttempt === 1) {
        events.push({
          ...makeMeta(),
          eventType: 'request.prepared',
          headers: redactHeaders(resolvedHeaders),
          method: step.method,
          url: resolvedUrlWithParams,
          bodySizeBytes: body ? new TextEncoder().encode(body).length : undefined,
        });
      }

      // Send request
      events.push({
        ...makeMeta(),
        eventType: 'request.sent',
        sentAt: new Date().toISOString() as Instant,
      });

      response = await fetch(resolvedUrlWithParams, {
        method: step.method,
        headers: resolvedHeaders,
        body,
        signal: controller.signal,
        redirect: 'manual',
      });

      durationMs = Date.now() - fetchStart;
      responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const responseText = await response.text();
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }

      bodySizeBytes = new TextEncoder().encode(responseText).length;

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

      // Check polling condition
      if (step.pollUntilExpression && pollMaxAttempts > 1) {
        // Resolve the polling expression against the response
        let conditionMet = false;
        try {
          const pollValue = jsonPathGet(responseBody, step.pollUntilExpression);
          if (pollValue !== undefined && pollValue !== null) {
            const strValue = String(pollValue);
            conditionMet = strValue === 'true' || strValue === '1';
            // Also check if the expression itself is satisfied
            if (!conditionMet) {
              // For expressions like "${status}", resolve via variables
              const resolved = variables.resolve(step.pollUntilExpression);
              conditionMet = resolved === 'true' || resolved === '1' || resolved.includes('true');
            }
          }
        } catch {
          // If expression evaluation fails, stop polling
          conditionMet = true;
        }

        if (conditionMet) break;

        // Check duration limit
        if (pollMaxDurationMs > 0 && Date.now() - pollStart >= pollMaxDurationMs) {
          // Exceeded max duration; continue with last response
          break;
        }

        // Wait before next poll
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }

      // No polling configured, or only one attempt — exit after first request
      break;
    }

    clearTimeout(timeout);

    // Ensure response is available (always set after at least one poll attempt)
    if (!response) {
      throw new Error('No response received — polling loop produced no result');
    }

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
        // Emit retry event before retrying
        const retryEvent: StepRetriedEvent = {
          runId,
          sequence: nextSeq(),
          timestamp: new Date().toISOString() as Instant,
          attempt,
          stepId: step.stepId,
          eventType: 'step.retried',
          reason: stepResult.error?.message ?? 'unknown error',
          retryNumber: attempt,
        };
        allEvents.push(retryEvent);
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

  // ── Execute Teardown Phase ──────────────────────────────────────
  if (plan.teardown && plan.teardown.steps.length > 0) {
    // Emit teardown.started event
    const tdStartedEvent: StepStartedEvent = {
      runId,
      sequence: nextSeq(),
      timestamp: new Date().toISOString() as Instant,
      attempt: 1,
      stepId: 'teardown' as EntityId,
      eventType: 'step.started',
      resolvedUrl: '(teardown phase)',
    };
    allEvents.push(tdStartedEvent);

    for (let ti = 0; ti < plan.teardown.steps.length; ti++) {
      // biome-ignore lint/style/noNonNullAssertion: loop index check
      const tdStep = plan.teardown.steps[ti]!;

      if (!tdStep.enabled) continue;

      let tdResult: StepExecutionResult | null = null;
      const tdMaxRetries = tdStep.maxRetries ?? 1;

      // Convert FrozenTeardownStep to FrozenStep for executeStep compatibility
      const tdFrozenStep: FrozenStep = {
        stepId: tdStep.stepId,
        sequence: ti,
        method: tdStep.method,
        urlTemplate: tdStep.urlTemplate,
        headers: tdStep.headers ?? {},
        body: tdStep.body,
        maxRetries: tdMaxRetries,
        retryBaseDelayMs: 1000,
        retryBackoffMultiplier: 2,
        retryOnNetworkError: true,
        onFailure: 'stop',
        assertions: [],
        extractions: [],
        sideEffect: 'cleanup-required',
        enabled: true,
        timeoutMs: tdStep.timeoutMs,
      };

      for (let attempt = 1; attempt <= tdMaxRetries + 1; attempt++) {
        tdResult = await executeStep(tdFrozenStep, variables, ti, runId, attempt);
        for (const event of tdResult.events) {
          allEvents.push({ ...event, sequence: nextSeq() });
        }
        if (tdResult.status === 'passed') break;
      }
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
