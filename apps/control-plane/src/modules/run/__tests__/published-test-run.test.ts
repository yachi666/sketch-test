import { expect, test } from 'vitest';
import { bindEnvironmentSteps } from '../published-test-run.service.js';
import { compileTestCaseVersionPlan } from '../test-plan-compiler.js';

const plan = () =>
  compileTestCaseVersionPlan('tcv_1', {
    schemaVersion: 'sketch-test.test/v1',
    id: 'test_1',
    name: 'Get user',
    request: { method: 'GET', url: '${env.baseUrl}/users/${env.userId}' },
    assertions: [{ id: 'status', target: 'status', operator: 'equals', expected: 200 }],
  });
test('freezes inputs without mutating the published plan', () => {
  const original = plan();
  const steps = bindEnvironmentSteps(original.steps, {
    baseUrl: 'https://example.test',
    userId: '123',
  });
  expect(steps[0]?.urlTemplate).toBe('https://example.test/users/123');
  expect(original.steps[0]?.urlTemplate).toContain('${env.');
});
test('missing variables and invalid target protocols fail before execution', () => {
  expect(() => bindEnvironmentSteps(plan().steps, { baseUrl: 'https://example.test' })).toThrow(
    'userId',
  );
  expect(() => bindEnvironmentSteps(plan().steps, { baseUrl: 'file:///tmp', userId: '1' })).toThrow(
    'HTTP(S)',
  );
});
