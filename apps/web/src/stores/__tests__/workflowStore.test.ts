import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { WorkflowStep } from '../../types';

const {
  mockCreateRunFromWorkflow,
  mockGetRun,
  mockGetWorkflow,
  mockListWorkflowVersions,
  mockListWorkflows,
  mockSaveWorkflowDraft,
} = vi.hoisted(() => ({
  mockCreateRunFromWorkflow: vi.fn(),
  mockGetRun: vi.fn(),
  mockGetWorkflow: vi.fn(),
  mockListWorkflowVersions: vi.fn(),
  mockListWorkflows: vi.fn(),
  mockSaveWorkflowDraft: vi.fn(),
}));

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    createRunFromWorkflow: (...args: unknown[]) => mockCreateRunFromWorkflow(...args),
    getRun: (...args: unknown[]) => mockGetRun(...args),
    getWorkflow: (...args: unknown[]) => mockGetWorkflow(...args),
    listWorkflowVersions: (...args: unknown[]) => mockListWorkflowVersions(...args),
    listWorkflows: (...args: unknown[]) => mockListWorkflows(...args),
    saveWorkflowDraft: (...args: unknown[]) => mockSaveWorkflowDraft(...args),
  },
}));

import { useWorkflowStore } from '../workflowStore';

const testStep: WorkflowStep = {
  id: 'step-1',
  name: 'Get users',
  method: 'GET',
  path: 'https://api.example.test/users',
  icon: 'user',
  tone: 'green',
  variableName: 'userId',
  variablePath: '$.data.id',
  expectedStatus: 200,
  assertion: '$.data',
};

describe('workflowStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowStore.setState({
      activeWorkflowId: null,
      activeWorkflow: null,
      activeVersionId: null,
      versions: [],
      steps: [],
      selectedId: '',
      logs: [],
      runState: 'idle',
      currentRunId: null,
      cpWorkflows: [],
      loading: false,
      saving: false,
      publishing: false,
      error: null,
    } as never);
    useWorkflowStore.getState().runningRef.current = false;
  });

  test('loads the workflow and immutable version from Control Plane', async () => {
    mockGetWorkflow.mockResolvedValue({ workflow: { id: 'wf-1', name: 'Checkout' } });
    mockListWorkflowVersions.mockResolvedValue({
      versions: [
        {
          id: 'wv-1',
          workflowId: 'wf-1',
          version: 1,
          definition: {
            name: 'Checkout',
            steps: [{ id: 'step-1', name: 'Get users', method: 'GET', url: testStep.path }],
          },
          compiledPlan: null,
          publishedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    await useWorkflowStore.getState().openWorkflow('wf-1');

    expect(useWorkflowStore.getState().activeWorkflowId).toBe('wf-1');
    expect(useWorkflowStore.getState().steps).toMatchObject([{ path: testStep.path }]);
    expect(mockGetWorkflow).toHaveBeenCalledWith('wf-1');
  });

  test('saves a draft version to Control Plane instead of local storage', async () => {
    useWorkflowStore.setState({
      activeWorkflowId: 'wf-1',
      activeWorkflow: { id: 'wf-1', name: 'Checkout' },
      steps: [testStep],
    } as never);
    mockSaveWorkflowDraft.mockResolvedValue({
      version: {
        id: 'wv-1',
        workflowId: 'wf-1',
        version: 1,
        definition: {},
        compiledPlan: null,
        publishedAt: '2026-01-01T00:00:00Z',
      },
    });

    await useWorkflowStore.getState().saveDraft();

    expect(mockSaveWorkflowDraft).toHaveBeenCalledWith(
      'wf-1',
      expect.objectContaining({ name: 'Checkout' }),
    );
    expect(useWorkflowStore.getState().activeVersionId).toBe('wv-1');
  });

  test('runs only a published workflow version and maps real events to logs', async () => {
    useWorkflowStore.setState({
      activeVersionId: 'wv-1',
      versions: [{ id: 'wv-1', compiledPlan: {} }],
      steps: [testStep],
      logs: [
        {
          id: 'log-step-1',
          stepId: 'step-1',
          name: testStep.name,
          method: 'GET',
          path: testStep.path,
          status: 'queued',
        },
      ],
    } as never);
    mockCreateRunFromWorkflow.mockResolvedValue({ runId: 'run-1' });
    mockGetRun.mockResolvedValue({
      run: { id: 'run-1', status: 'passed' },
      steps: [
        {
          stepIndex: 0,
          eventType: 'response.received',
          payload: { statusCode: 200 },
          createdAt: '2026-01-01T00:00:01Z',
        },
        {
          stepIndex: 0,
          eventType: 'step.finished',
          payload: { status: 'passed', totalDurationMs: 24 },
          createdAt: '2026-01-01T00:00:02Z',
        },
      ],
    });

    await useWorkflowStore.getState().runWorkflow();

    expect(mockCreateRunFromWorkflow).toHaveBeenCalledWith('wv-1');
    expect(useWorkflowStore.getState().runState).toBe('passed');
    expect(useWorkflowStore.getState().logs[0]).toMatchObject({
      status: 'passed',
      code: 200,
      duration: 24,
    });
  });

  test('rejects runs for an unpublished version', async () => {
    useWorkflowStore.setState({
      activeVersionId: 'wv-1',
      versions: [{ id: 'wv-1', compiledPlan: null }],
    } as never);

    await useWorkflowStore.getState().runWorkflow();

    expect(mockCreateRunFromWorkflow).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().error).toContain('尚未发布');
  });

  test('lists workflows from the authenticated workspace', async () => {
    mockListWorkflows.mockResolvedValue({ workflows: [{ id: 'wf-1', name: 'Checkout' }] });

    await useWorkflowStore.getState().fetchWorkflowsFromServer('ws-1');

    expect(mockListWorkflows).toHaveBeenCalledWith('ws-1');
    expect(useWorkflowStore.getState().cpWorkflows).toHaveLength(1);
  });
});

test('preserves imported contract fields on save and only changes edited request fields', async () => {
  const definition = {
    schemaVersion: 'sketch-test.workflow/v1',
    name: 'Imported',
    description: 'Keep me',
    source: { uri: 'real.arazzo.yml' },
    teardown: {
      strategy: 'always',
      steps: [
        {
          id: 'cleanup',
          useTest: { kind: 'inline', method: 'GET', url: 'https://example.test/cleanup' },
        },
      ],
    },
    steps: [
      {
        id: 'get',
        name: 'Fetch',
        useTest: {
          kind: 'inline',
          method: 'GET',
          url: 'https://api.github.com/repos/nodejs/node',
          headers: { Accept: 'application/json' },
        },
        retry: { maxRetries: 2 },
        onFailure: 'teardown-and-stop',
        extract: [
          { name: 'owner', expression: '$.owner', source: 'body', scope: 'workflow' },
          { name: 'name', expression: '$.name', source: 'body' },
        ],
        assertions: [
          { id: 'ok', target: 'status', operator: 'equals', expected: 200 },
          {
            id: 'full',
            target: 'jsonPath',
            path: '$.full_name',
            operator: 'equals',
            expected: 'nodejs/node',
          },
        ],
      },
    ],
  };
  mockGetWorkflow.mockResolvedValue({ workflow: { id: 'wf-imported', name: 'Imported' } });
  mockListWorkflowVersions.mockResolvedValue({ versions: [{ id: 'v1', definition }] });
  mockSaveWorkflowDraft.mockImplementation(async (_id, definition) => ({
    version: { id: 'v2', definition },
  }));
  await useWorkflowStore.getState().openWorkflow('wf-imported');
  expect(useWorkflowStore.getState().steps[0]?.path).toBe(definition.steps[0]?.useTest.url);
  await useWorkflowStore.getState().saveDraft();
  expect(mockSaveWorkflowDraft).toHaveBeenLastCalledWith('wf-imported', definition);
  useWorkflowStore.getState().setSteps((steps) =>
    steps.map((step) => ({
      ...step,
      path: 'https://api.github.com/repos/nodejs/node/commits',
      headers: [{ name: 'Accept', value: 'application/vnd.github+json' }],
    })),
  );
  await useWorkflowStore.getState().saveDraft();
  const saved = mockSaveWorkflowDraft.mock.calls.at(-1)?.[1];
  expect(saved.teardown).toEqual(definition.teardown);
  expect(saved.steps[0].assertions).toEqual(definition.steps[0]?.assertions);
  expect(saved.steps[0].extract).toEqual(definition.steps[0]?.extract);
  expect(saved.steps[0].useTest).toMatchObject({
    url: 'https://api.github.com/repos/nodejs/node/commits',
    headers: { Accept: 'application/vnd.github+json' },
  });
  expect(definition.steps[0]?.useTest.url).toBe('https://api.github.com/repos/nodejs/node');
});
