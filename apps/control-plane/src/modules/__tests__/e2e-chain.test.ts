/**
 * End-to-end chain integration test.
 *
 * Validates the full cross-module flow:
 *   Generation → Workflow Compilation → ExecutionPlan validation
 *
 * No database — tests pure contract compatibility across modules.
 * This is the "闭环" test: it proves the chain works end to end.
 */

import type { ExecutionPlan } from '@sketch-test/runner-protocol';
import { describe, expect, test } from 'vitest';

// ─── Generation imports ────────────────────────────────────────

import {
  buildHappyPathRequest,
  type EndpointDef,
  type SchemaNode,
} from '../generation/generation.service';

// ─── Workflow Compiler imports ──────────────────────────────────

import {
  compileWorkflow,
  type WorkflowDefInput,
  type WorkflowStepDef,
} from '../workflow/workflow-compiler';

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Schema map matching generation service's ref-based lookup.
 * SchemaNode uses `ref` to point to other schemas.
 */
function makeSchemas(): Record<string, SchemaNode> {
  return {
    UserCreate: {
      type: 'object',
      properties: {
        name: { ref: 'StringType', displayName: 'name' },
        email: { ref: 'EmailType', displayName: 'email' },
        age: { ref: 'IntType', displayName: 'age' },
      },
      required: ['name', 'email'],
    },
    StringType: { type: 'string', minLength: 1 },
    EmailType: { type: 'string', format: 'email' },
    IntType: { type: 'integer', minimum: 0, maximum: 150 },
  };
}

/**
 * Validate that an ExecutionPlan meets the minimum requirements
 * for the Runner to execute it.
 */
function validateExecutionPlan(plan: ExecutionPlan): string[] {
  const issues: string[] = [];

  if (plan.schemaVersion !== 'sketch-test.runner-protocol/v1') {
    issues.push('Invalid schema version');
  }
  if (!plan.planId || typeof plan.planId !== 'string') issues.push('Missing plan.planId');
  if (!plan.planHash) issues.push('Missing plan.planHash');
  if (!plan.compiledAt) issues.push('Missing plan.compiledAt');
  if (!Array.isArray(plan.steps)) {
    issues.push('Missing plan.steps array');
    return issues;
  }
  if (plan.steps.length === 0) issues.push('Plan has no steps');

  for (const step of plan.steps) {
    if (!step.stepId) issues.push(`Step ${step.sequence}: missing stepId`);
    if (typeof step.sequence !== 'number') issues.push(`Step has invalid sequence type`);
    if (typeof step.enabled !== 'boolean')
      issues.push(`Step ${step.sequence}: missing enabled flag`);
    if (typeof step.timeoutMs !== 'number' || step.timeoutMs <= 0)
      issues.push(`Step ${step.sequence}: invalid timeoutMs`);
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(step.method)) {
      issues.push(`Step ${step.sequence}: invalid method ${step.method}`);
    }
    if (!step.onFailure) issues.push(`Step ${step.sequence}: missing onFailure`);
    if (!Array.isArray(step.assertions)) issues.push(`Step ${step.sequence}: assertions not array`);
    if (!Array.isArray(step.extractions))
      issues.push(`Step ${step.sequence}: extractions not array`);
    for (const a of step.assertions) {
      if (!a.id) issues.push(`Step ${step.sequence}: assertion missing id`);
      if (!a.target) issues.push(`Step ${step.sequence}: assertion missing target`);
      if (!a.operator) issues.push(`Step ${step.sequence}: assertion missing operator`);
    }
    for (const e of step.extractions ?? []) {
      if (!e.name) issues.push(`Step ${step.sequence}: extraction missing name`);
      if (!e.source) issues.push(`Step ${step.sequence}: extraction missing source`);
      if (!e.expression) issues.push(`Step ${step.sequence}: extraction missing expression`);
    }
  }
  return issues;
}

// ─── Chain: Generation → Compilation → Validation ───────────────

describe('E2E: Generation → Compilation → ExecutionPlan', () => {
  test('chain: happy-path request can be compiled into a valid ExecutionPlan', async () => {
    // Step 1: Generate a happy-path request from an endpoint definition
    const schemas = makeSchemas();
    const endpoint: EndpointDef = {
      id: 'post /api/users',
      method: 'POST',
      path: '/api/users',
      summary: 'Create user',
      description: 'Creates a new user account',
      tags: ['Users'],
      parameters: [],
      requestBodies: [
        {
          id: 'rb-1',
          required: true,
          content: {
            'application/json': {
              schema: { ref: 'UserCreate' },
            },
          },
        },
      ],
      responses: [
        { id: 'resp-201', statusCode: 201, description: 'Created' },
        { id: 'resp-400', statusCode: 400, description: 'Bad Request' },
      ],
    };

    const happyPathReq = buildHappyPathRequest(endpoint, schemas);

    // Verify generation output
    expect(happyPathReq).not.toBeNull();
    expect(happyPathReq!.method).toBe('POST');
    expect(happyPathReq!.url).toBe('/api/users');
    expect(happyPathReq!.body).toBeDefined();
    const body = happyPathReq!.body as Record<string, unknown>;
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('email');

    // Step 2: Build a workflow definition using the generated request
    const loginStep: WorkflowStepDef = {
      id: 'step-login',
      name: 'Login',
      method: 'POST',
      url: '${env.BASE_URL}/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'test@sketch.dev', password: 'test123456' },
      extract: [
        {
          name: 'accessToken',
          source: 'body',
          expression: '$.data.accessToken',
          scope: 'workflow',
        },
      ],
      assertions: [
        { target: 'status', operator: 'equals', expected: 200, description: 'Login succeeds' },
      ],
    };

    const createUserStep: WorkflowStepDef = {
      id: 'step-create-user',
      name: 'Create User',
      method: 'POST',
      url: '${env.BASE_URL}/api/users',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ${accessToken}',
      },
      body: happyPathReq!.body,
      assertions: [
        { target: 'status', operator: 'equals', expected: 201, description: 'User created' },
        { target: 'jsonPath', path: '$.data.userId', operator: 'exists' } as any,
      ],
      extract: [{ name: 'userId', source: 'body', expression: '$.data.userId', scope: 'workflow' }],
    };

    const getUsersStep: WorkflowStepDef = {
      id: 'step-list-users',
      name: 'List Users',
      method: 'GET',
      url: '${env.BASE_URL}/api/users',
      headers: { Authorization: 'Bearer ${accessToken}' },
      assertions: [
        { target: 'status', operator: 'equals', expected: 200, description: 'List succeeds' },
      ],
    };

    const workflowInput: WorkflowDefInput = {
      name: 'User CRUD Flow',
      steps: [loginStep, createUserStep, getUsersStep],
      teardown: [],
      description: 'E2E test workflow',
    } as any;

    // Step 3: Compile the workflow (async!)
    const result = await compileWorkflow(workflowInput);

    // Should succeed
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.success).toBe(true);

    // Result should have a planId and steps
    expect(result.plan!.planId).toBeTruthy();
    expect(result.plan!.steps).toHaveLength(3);

    // Step 4: Validate the ExecutionPlan for runner compatibility
    const issues = validateExecutionPlan(result.plan!);
    expect(issues).toHaveLength(0);

    // Step 5: Verify step ordering is preserved
    result.plan!.steps.forEach((step, i) => {
      expect(step.sequence).toBe(i);
    });
  });

  test('chain: compiled workflow has frozen version references', async () => {
    const workflowInput: WorkflowDefInput = {
      name: 'Simple Chain',
      steps: [
        {
          id: 's1',
          name: 'Step 1',
          method: 'GET',
          url: 'https://httpbin.org/get',
          assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
        },
        {
          id: 's2',
          name: 'Step 2',
          method: 'POST',
          url: 'https://httpbin.org/post',
          body: { data: 'test' },
          assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
        },
      ],
      teardown: [],
    };

    const result = await compileWorkflow(workflowInput);
    expect(result.success).toBe(true);

    const plan = result.plan!;
    expect(plan.schemaVersion).toBe('sketch-test.runner-protocol/v1');
    expect(plan.planHash).toHaveLength(64);

    // Steps should have all required FrozenStep fields
    for (const step of plan.steps) {
      expect(step.stepId).toBeTruthy();
      expect(step.sequence).toBeGreaterThanOrEqual(0);
      expect(step.method).toBeTruthy();
      expect(step.urlTemplate).toBeTruthy();
      expect(step.timeoutMs).toBeGreaterThan(0);
      expect(step.enabled).toBe(true);
      expect(Array.isArray(step.assertions)).toBe(true);
      expect(Array.isArray(step.extractions)).toBe(true);
    }
  });

  test('chain: compile detects missing variable producers', async () => {
    const workflowInput: WorkflowDefInput = {
      name: 'Broken Chain',
      steps: [
        {
          id: 's1',
          name: 'Step 1',
          method: 'GET',
          url: '/api/data',
          headers: { Authorization: 'Bearer ${neverProduced}' },
          assertions: [],
        },
      ],
      teardown: [],
    };

    const result = await compileWorkflow(workflowInput);

    // Should produce a warning about unresolved variable
    const warnings = result.diagnostics.filter(
      (d) => d.severity === 'warning' && d.message.includes('neverProduced'),
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  test('chain: compile detects forward references', async () => {
    const workflowInput: WorkflowDefInput = {
      name: 'Forward Ref',
      steps: [
        {
          id: 's1',
          name: 'Step 1',
          method: 'GET',
          url: '/api/data/${laterToken}',
          assertions: [],
        },
        {
          id: 's2',
          name: 'Step 2',
          method: 'POST',
          url: '/api/auth',
          extract: [
            { name: 'laterToken', source: 'body', expression: '$.token', scope: 'workflow' },
          ],
          assertions: [],
        },
      ],
      teardown: [],
    };

    const result = await compileWorkflow(workflowInput);

    // Should detect that step 1 references a variable produced by step 2
    const forwardRefErrors = result.diagnostics.filter(
      (d) => d.severity === 'error' && d.message.includes('later step'),
    );
    expect(forwardRefErrors.length).toBeGreaterThan(0);
  });

  test('chain: teardown steps are compiled into plan.teardown', async () => {
    const workflowInput: WorkflowDefInput = {
      name: 'With Cleanup',
      steps: [
        {
          id: 'main-step',
          name: 'Main',
          method: 'POST',
          url: '/api/resource',
          assertions: [{ target: 'status', operator: 'equals', expected: 201 }],
        },
      ],
      teardown: [
        {
          id: 'cleanup-step',
          name: 'Cleanup',
          method: 'DELETE',
          url: '/api/resource/${resourceId}',
        },
      ],
    };

    const result = await compileWorkflow(workflowInput);
    expect(result.success).toBe(true);

    const plan = result.plan!;
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);

    // Teardown steps are stored in plan.teardown, not plan.steps
    expect(plan.teardown).toBeDefined();
    expect(plan.teardown!.strategy).toBe('always');
    expect(plan.teardown!.steps).toHaveLength(1);
    expect(plan.teardown!.steps[0]!.stepId).toBe('cleanup-step');
    expect(plan.teardown!.steps[0]!.method).toBe('DELETE');
  });

  test('chain: large workflow compiles without errors', async () => {
    // Simulate a realistic 10-step flow
    const steps: WorkflowStepDef[] = [];
    for (let i = 1; i <= 10; i++) {
      steps.push({
        id: `step-${i}`,
        name: `Step ${i}`,
        method: i % 2 === 0 ? 'GET' : 'POST',
        url: `https://api.example.com/resource/${i}`,
        headers: i > 1 ? { Authorization: 'Bearer ${token}' } : undefined,
        body: i % 2 === 0 ? undefined : { index: i },
        assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
      });
    }

    // First step produces the token
    steps[0] = {
      ...steps[0]!,
      extract: [{ name: 'token', source: 'body', expression: '$.token', scope: 'workflow' }],
    };

    const workflowInput: WorkflowDefInput = {
      name: 'Large Flow',
      steps,
      teardown: [
        {
          id: 'cleanup',
          name: 'Cleanup',
          method: 'DELETE',
          url: 'https://api.example.com/resource/all',
          headers: { Authorization: 'Bearer ${token}' },
        },
      ],
    };

    const result = await compileWorkflow(workflowInput);

    // Should compile without fatal errors
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(0);
    expect(result.success).toBe(true);

    // All steps should be present in the plan
    expect(result.plan!.steps.length).toBeGreaterThanOrEqual(10);
  });

  test('chain: generated request body is valid JSON-compatible', () => {
    const schemas = makeSchemas();
    const endpoint: EndpointDef = {
      id: 'post /api/users',
      method: 'POST',
      path: '/api/users',
      summary: 'Create user',
      description: 'Creates a new user',
      tags: ['Users'],
      parameters: [],
      requestBodies: [
        {
          id: 'rb-1',
          required: true,
          content: {
            'application/json': {
              schema: { ref: 'UserCreate' },
            },
          },
        },
      ],
      responses: [{ id: 'resp-201', statusCode: 201, description: 'Created' }],
    };

    const happyPathReq = buildHappyPathRequest(endpoint, schemas);
    expect(happyPathReq).not.toBeNull();

    const body = happyPathReq!.body as Record<string, unknown>;
    // All required fields should be present
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('email');

    // Types should match (age is optional so may be absent)
    expect(typeof body['name']).toBe('string');
    expect(typeof body['email']).toBe('string');

    // Should be JSON-serializable
    expect(() => JSON.stringify(body)).not.toThrow();
  });
});
