import { WorkflowDefinitionSchema } from '@sketch-test/workflow-dsl';
import Fastify from 'fastify';
import { expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ saveDraft: vi.fn(), getWorkflow: vi.fn() }));
vi.mock('../workflow.service.js', () => ({
  ...mocks,
  compileWorkflowPreview: vi.fn(),
  createWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  getWorkflowVersion: vi.fn(),
  listWorkflows: vi.fn(),
  listWorkflowVersions: vi.fn(),
  publishVersion: vi.fn(),
  updateWorkflow: vi.fn(),
}));
vi.mock('../arazzo-import.service.js', () => ({
  ArazzoImportError: class extends Error {},
  importArazzoWorkflows: vi.fn(),
}));

import { workflowRoutes } from '../workflow.routes.js';

test('draft save accepts and retains the full imported WorkflowDefinition contract', async () => {
  const definition = WorkflowDefinitionSchema.parse({
    schemaVersion: 'sketch-test.workflow/v1',
    id: 'wf-definition',
    name: 'GitHub flow',
    description: 'Retain description',
    tags: ['real'],
    steps: [
      {
        id: 'metadata',
        name: 'Metadata',
        useTest: {
          kind: 'inline',
          method: 'GET',
          url: 'https://api.github.com/repos/nodejs/node',
          headers: { Accept: 'application/json' },
        },
        assertions: [{ id: 'status', target: 'status', operator: 'equals', expected: 200 }],
      },
    ],
    teardown: {
      strategy: 'always',
      steps: [
        {
          id: 'cleanup',
          name: 'Read cleanup',
          useTest: { kind: 'inline', method: 'GET', url: 'https://example.test/cleanup' },
        },
      ],
    },
  });
  mocks.getWorkflow.mockResolvedValue({ id: 'wf-1' });
  mocks.saveDraft.mockImplementation(async (_id, definition) => ({ id: 'v2', definition }));
  const app = Fastify();
  await workflowRoutes(app);
  try {
    const result = await app.inject({
      method: 'POST',
      url: '/api/workflows/wf-1/versions',
      payload: { definition },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json().version.definition).toEqual(definition);
    expect(mocks.saveDraft).toHaveBeenCalledWith('wf-1', definition);
  } finally {
    await app.close();
  }
});
