/** Compile one immutable TestCaseVersion into a Runner ExecutionPlan. */
import type { ExecutionPlan, FrozenStep } from '@sketch-test/runner-protocol';
import { type TestDefinition, TestDefinitionSchema } from '@sketch-test/test-dsl';
import { executionPlanContentHash } from '../../shared/execution-plan-hash.js';

export class TestPlanCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestPlanCompileError';
  }
}

function compileAuth(definition: TestDefinition): {
  headers: Record<string, string>;
  query: Record<string, string>;
} {
  const headers = { ...(definition.request.headers ?? {}) };
  const query = { ...(definition.request.query ?? {}) };
  const auth = definition.request.auth;
  if (!auth || auth.type === 'none') return { headers, query };

  if (auth.type === 'bearer') {
    if (!auth.token) throw new TestPlanCompileError('Bearer authentication requires a token');
    headers['Authorization'] = `Bearer ${auth.token}`;
    return { headers, query };
  }

  if (auth.type === 'api-key') {
    if (!auth.keyName || !auth.keyValue || !auth.keyIn) {
      throw new TestPlanCompileError('API key authentication requires keyName, keyValue and keyIn');
    }
    if (auth.keyIn === 'header') headers[auth.keyName] = auth.keyValue;
    else query[auth.keyName] = auth.keyValue;
    return { headers, query };
  }

  throw new TestPlanCompileError(
    `Authentication type ${auth.type} cannot be frozen safely by the current Runner Protocol`,
  );
}

function compileBody(definition: TestDefinition, headers: Record<string, string>): unknown {
  const body = definition.request.body;
  if (!body || body.type === 'none') return undefined;
  if (body.type === 'json' || body.type === 'text') {
    headers['Content-Type'] ??= body.mediaType;
    return body.value;
  }
  throw new TestPlanCompileError(
    `Request body type ${body.type} cannot be serialized safely by the current Runner Protocol`,
  );
}

export function compileTestCaseVersionPlan(
  testCaseVersionId: string,
  rawDefinition: unknown,
  compiledAt = new Date().toISOString(),
): ExecutionPlan {
  const parsed = TestDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) {
    throw new TestPlanCompileError(
      `TestCaseVersion ${testCaseVersionId} contains an invalid TestDefinition: ${parsed.error.message}`,
    );
  }

  const definition = parsed.data;
  const { headers, query } = compileAuth(definition);
  const body = compileBody(definition, headers);
  const step: FrozenStep = {
    stepId: `${testCaseVersionId}-step`,
    sequence: 0,
    method: definition.request.method,
    urlTemplate: definition.request.url,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    query: Object.keys(query).length > 0 ? query : undefined,
    body,
    maxRetries: 0,
    retryBaseDelayMs: 1000,
    retryBackoffMultiplier: 2,
    retryOnNetworkError: true,
    onFailure: 'stop',
    assertions: definition.assertions.map((assertion) => ({
      id: assertion.id,
      description: assertion.description,
      target: assertion.target,
      path: assertion.path ?? assertion.headerName,
      operator: assertion.operator,
      expected: assertion.expected ?? assertion.statusCode,
      severity: assertion.severity,
    })),
    extractions: definition.extract ?? [],
    sideEffect: definition.sideEffect,
    enabled: true,
    timeoutMs: definition.request.timeoutMs,
    originTestVersionId: testCaseVersionId,
  };

  return {
    schemaVersion: 'sketch-test.runner-protocol/v1',
    planId: `plan-${testCaseVersionId}`,
    planHash: executionPlanContentHash([step]),
    testCaseVersionId,
    compiledAt,
    steps: [step],
  };
}
