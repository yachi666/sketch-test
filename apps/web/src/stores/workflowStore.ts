import { create } from 'zustand';
import { cpClient, type Workflow, type WorkflowVersion } from '../lib/cp-client';
import type { ExecutionLog, RunState, WorkflowStep } from '../types';

type RequestFields = {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};
type EditorStepDefinition = RequestFields & {
  id: string;
  name: string;
  useTest?: string | (RequestFields & { kind: string; testVersionId?: string });
  extract?: Array<{ name: string; expression: string; [key: string]: unknown }>;
  assertions?: Array<{
    target: string;
    path?: string;
    operator: string;
    expected?: unknown;
    [key: string]: unknown;
  }>;
};
type WorkflowDefinition = {
  schemaVersion?: string;
  name: string;
  steps: EditorStepDefinition[];
  [key: string]: unknown;
};

interface WorkflowState {
  activeWorkflowId: string | null;
  activeWorkflow: Workflow | null;
  activeVersionId: string | null;
  versions: WorkflowVersion[];
  steps: WorkflowStep[];
  selectedId: string;
  logs: ExecutionLog[];
  runState: RunState;
  runningRef: { current: boolean };
  currentRunId: string | null;
  cpWorkflows: Workflow[];
  loading: boolean;
  saving: boolean;
  publishing: boolean;
  error: string | null;

  setActiveWorkflowId: (id: string | null) => void;
  setSteps: (stepsOrUpdater: WorkflowStep[] | ((prev: WorkflowStep[]) => WorkflowStep[])) => void;
  setSelectedId: (id: string) => void;
  setRunState: (state: RunState) => void;
  openWorkflow: (workflowId: string) => Promise<void>;
  backToList: () => void;
  saveDraft: () => Promise<WorkflowVersion | null>;
  publishDraft: () => Promise<WorkflowVersion | null>;
  runWorkflow: () => Promise<void>;
  fetchWorkflowsFromServer: (workspaceId: string) => Promise<void>;
  createWorkflow: (
    workspaceId: string,
    name: string,
    description?: string,
  ) => Promise<Workflow | null>;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function methodTone(method: string): WorkflowStep['tone'] {
  if (method === 'POST') return 'green';
  if (method === 'DELETE') return 'brick';
  if (method === 'PUT' || method === 'PATCH') return 'amber';
  return 'brown';
}

function methodIcon(method: string): WorkflowStep['icon'] {
  if (method === 'POST') return 'cart';
  if (method === 'DELETE') return 'card';
  if (method === 'PUT' || method === 'PATCH') return 'lock';
  return 'verify';
}

function asMethod(method: string | undefined): WorkflowStep['method'] {
  const normalized = method?.toUpperCase();
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(normalized ?? '')
    ? (normalized as WorkflowStep['method'])
    : 'GET';
}

function definitionToSteps(definition: unknown): WorkflowStep[] {
  const candidate = definition as Partial<WorkflowDefinition> | null;
  if (!candidate || !Array.isArray(candidate.steps)) return [];
  return candidate.steps.map((step, index) => {
    const request =
      typeof step.useTest === 'object' && step.useTest.kind === 'inline' ? step.useTest : step;
    const method = asMethod(request.method);
    const extraction = step.extract?.[0];
    const statusAssertion = step.assertions?.find((assertion) => assertion.target === 'status');
    const bodyAssertion = step.assertions?.find((assertion) => assertion.target !== 'status');
    return {
      id: step.id || `step-${index + 1}`,
      name: step.name || `步骤 ${index + 1}`,
      method,
      path: request.url || '',
      headers: Object.entries(request.headers ?? {}).map(([name, value]) => ({ name, value })),
      requestReference:
        typeof step.useTest === 'string'
          ? step.useTest
          : step.useTest?.kind === 'test-version'
            ? step.useTest.testVersionId
            : undefined,
      icon: methodIcon(method),
      tone: methodTone(method),
      variableName: extraction?.name ?? '',
      variablePath: extraction?.expression ?? '',
      expectedStatus:
        statusAssertion && typeof statusAssertion.expected === 'number'
          ? statusAssertion.expected
          : 200,
      assertion: bodyAssertion?.path ?? '',
    };
  });
}

function stepsToDefinition(
  name: string,
  steps: WorkflowStep[],
  original?: unknown,
): WorkflowDefinition {
  const base = original as WorkflowDefinition | undefined;
  const originals = new Map((base?.steps ?? []).map((step) => [step.id, step]));
  const views = new Map(definitionToSteps(base).map((step) => [step.id, step]));
  const canonical = base?.steps?.some((step) => typeof step.useTest === 'object') ?? false;
  return {
    ...base,
    schemaVersion: base?.schemaVersion ?? 'sketch-test.workflow/v1',
    name: base?.name ?? name,
    steps: steps.map((step) => {
      const raw = originals.get(step.id);
      const before = views.get(step.id);
      const result: EditorStepDefinition = structuredClone(raw ?? { id: step.id, name: step.name });
      result.name = step.name.trim() || step.id;
      if (
        step.requestReference &&
        before &&
        (step.path !== before.path || step.method !== before.method)
      ) {
        throw new Error('引用用例的请求必须在用例版本中修改。');
      }
      const headersChanged =
        JSON.stringify(step.headers ?? []) !== JSON.stringify(before?.headers ?? []);
      const request =
        typeof result.useTest === 'object' && result.useTest.kind === 'inline'
          ? result.useTest
          : result;
      if (!step.requestReference) {
        if (!before || step.method !== before.method) request.method = step.method;
        if (!before || step.path !== before.path) request.url = step.path.trim();
        if (headersChanged) {
          const entries = (step.headers ?? []).map(
            ({ name, value }) => [name.trim(), value] as const,
          );
          if (entries.some(([key]) => !key || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key)))
            throw new Error('请填写有效的请求头名称。');
          if (new Set(entries.map(([key]) => key.toLowerCase())).size !== entries.length)
            throw new Error('请求头名称不能重复。');
          request.headers = Object.fromEntries(entries);
        }
      }
      if (
        !before ||
        step.variableName !== before.variableName ||
        step.variablePath !== before.variablePath
      ) {
        const rest = result.extract?.slice(1) ?? [];
        result.extract = step.variableName
          ? [
              {
                ...result.extract?.[0],
                name: step.variableName,
                source: 'body',
                expression: step.variablePath || '$',
              },
              ...rest,
            ]
          : rest;
      }
      if (!before || step.expectedStatus !== before.expectedStatus) {
        const assertions = result.assertions ?? [];
        const index = assertions.findIndex((item) => item.target === 'status');
        const value = {
          ...assertions[index],
          target: 'status',
          operator: 'equals',
          expected: step.expectedStatus,
        };
        if (index < 0) assertions.push(value);
        else assertions[index] = value;
        result.assertions = assertions;
      }
      if (!before || step.assertion !== before.assertion) {
        const assertions = result.assertions ?? [];
        const index = assertions.findIndex((item) => item.target !== 'status');
        if (step.assertion) {
          const value = {
            ...assertions[index],
            target: 'jsonPath',
            path: step.assertion,
            operator: 'exists',
          };
          if (index < 0) assertions.push(value);
          else assertions[index] = value;
        } else if (index >= 0) assertions.splice(index, 1);
        result.assertions = assertions;
      }
      if (!raw && canonical) {
        result.useTest = {
          kind: 'inline',
          method: result.method,
          url: result.url,
          ...(result.headers ? { headers: result.headers } : {}),
        };
        delete result.method;
        delete result.url;
        delete result.headers;
      }
      return result;
    }),
  };
}

function logsForSteps(steps: WorkflowStep[]): ExecutionLog[] {
  return steps.map((step) => ({
    id: `log-${step.id}`,
    stepId: step.id,
    name: step.name,
    method: step.method,
    path: step.path,
    status: 'queued',
  }));
}

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  activeWorkflowId: null,
  activeWorkflow: null,
  activeVersionId: null,
  versions: [],
  steps: [],
  selectedId: '',
  logs: [],
  runState: 'idle',
  runningRef: { current: false },
  currentRunId: null,
  cpWorkflows: [],
  loading: false,
  saving: false,
  publishing: false,
  error: null,

  setActiveWorkflowId: (activeWorkflowId) => set({ activeWorkflowId }),
  setSteps: (stepsOrUpdater) =>
    set((state) => ({
      steps:
        typeof stepsOrUpdater === 'function'
          ? (stepsOrUpdater as (prev: WorkflowStep[]) => WorkflowStep[])(state.steps)
          : stepsOrUpdater,
    })),
  setSelectedId: (selectedId) => set({ selectedId }),
  setRunState: (runState) => set({ runState }),

  fetchWorkflowsFromServer: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const { workflows } = await cpClient.listWorkflows(workspaceId);
      set({ cpWorkflows: workflows, loading: false });
    } catch (reason) {
      set({ loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    }
  },

  createWorkflow: async (workspaceId, name, description) => {
    set({ saving: true, error: null });
    try {
      const { workflow } = await cpClient.createWorkflow(workspaceId, name, description);
      set((state) => ({ cpWorkflows: [workflow, ...state.cpWorkflows], saving: false }));
      return workflow;
    } catch (reason) {
      set({ saving: false, error: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  },

  openWorkflow: async (workflowId) => {
    set({ loading: true, error: null, activeWorkflowId: workflowId });
    try {
      const [{ workflow }, { versions }] = await Promise.all([
        cpClient.getWorkflow(workflowId),
        cpClient.listWorkflowVersions(workflowId),
      ]);
      const latest = versions[0] ?? null;
      const steps = latest ? definitionToSteps(latest.definition) : [];
      set({
        activeWorkflow: workflow,
        activeVersionId: latest?.id ?? null,
        versions,
        steps,
        selectedId: steps[0]?.id ?? '',
        logs: logsForSteps(steps),
        runState: 'idle',
        currentRunId: null,
        loading: false,
      });
    } catch (reason) {
      set({
        activeWorkflowId: null,
        activeWorkflow: null,
        loading: false,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  },

  backToList: () =>
    set({
      activeWorkflowId: null,
      activeWorkflow: null,
      activeVersionId: null,
      versions: [],
      steps: [],
      selectedId: '',
      logs: [],
      runState: 'idle',
      currentRunId: null,
    }),

  saveDraft: async () => {
    const { activeWorkflowId, activeWorkflow, steps } = get();
    if (!activeWorkflowId || !activeWorkflow) return null;
    if (!steps.length) {
      set({ error: '至少需要一个步骤才能保存。' });
      return null;
    }
    set({ saving: true, error: null });
    try {
      const { version } = await cpClient.saveWorkflowDraft(
        activeWorkflowId,
        stepsToDefinition(
          activeWorkflow.name,
          steps,
          get().versions.find((version) => version.id === get().activeVersionId)?.definition,
        ),
      );
      set((state) => ({
        versions: [version, ...state.versions],
        activeVersionId: version.id,
        saving: false,
      }));
      return version;
    } catch (reason) {
      set({ saving: false, error: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  },

  publishDraft: async () => {
    // Persist editor changes before publication. Each version is immutable on the server.
    const saved = await get().saveDraft();
    if (!saved) return null;
    const versionId = saved.id;
    set({ publishing: true, error: null });
    try {
      const result = await cpClient.publishWorkflowVersion(versionId);
      if (!result.published) {
        set({
          publishing: false,
          error: result.diagnostics.map((item) => item.message).join('\n'),
        });
        return null;
      }
      const published: WorkflowVersion = {
        id: result.version.id,
        workflowId: result.version.workflowId,
        version: result.version.version,
        definition: saved.definition,
        compiledPlan: result.plan,
        publishedAt: result.version.publishedAt,
      };
      set((state) => ({
        versions: state.versions.map((version) =>
          version.id === published.id ? published : version,
        ),
        activeVersionId: published.id,
        publishing: false,
      }));
      return published;
    } catch (reason) {
      set({ publishing: false, error: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  },

  runWorkflow: async () => {
    const { runningRef, activeVersionId } = get();
    if (runningRef.current) return;
    if (!activeVersionId) {
      set({ error: '请先保存并发布一个工作流版本，再运行。' });
      return;
    }
    const selectedVersion = get().versions.find((version) => version.id === activeVersionId);
    if (!selectedVersion?.compiledPlan) {
      set({ error: '当前版本尚未发布。请先点击“保存并发布”。' });
      return;
    }
    runningRef.current = true;
    set({
      runState: 'running',
      currentRunId: null,
      error: null,
      logs: get().logs.map((log) => ({ ...log, status: 'running' })),
    });
    try {
      const { runId } = await cpClient.createRunFromWorkflow(activeVersionId);
      set({ currentRunId: runId });
      for (let i = 0; i < 30; i += 1) {
        await sleep(1_000);
        const detail = await cpClient.getRun(runId);
        set((state) => ({
          logs: state.logs.map((log, index) => {
            const events = detail.steps.filter((event) => event.stepIndex === index);
            const finished = events.filter((event) => event.eventType === 'step.finished').at(-1);
            const response = events
              .filter((event) => event.eventType === 'response.received')
              .at(-1);
            const finishedPayload = payloadRecord(finished?.payload);
            const responsePayload = payloadRecord(response?.payload);
            const rawStatus = String(finishedPayload['status'] ?? 'running');
            return {
              ...log,
              status:
                rawStatus === 'passed'
                  ? 'passed'
                  : rawStatus === 'failed' || rawStatus === 'error'
                    ? 'failed'
                    : 'running',
              code:
                typeof responsePayload['statusCode'] === 'number'
                  ? responsePayload['statusCode']
                  : undefined,
              duration:
                typeof finishedPayload['totalDurationMs'] === 'number'
                  ? finishedPayload['totalDurationMs']
                  : undefined,
              timestamp: finished?.createdAt
                ? new Date(finished.createdAt).toLocaleTimeString('zh-CN', { hour12: false })
                : undefined,
              message:
                typeof finishedPayload['error'] === 'object'
                  ? String((finishedPayload['error'] as Record<string, unknown>)['message'] ?? '')
                  : undefined,
              events: events.map((event) => ({
                eventType: event.eventType,
                payload: event.payload,
                timestamp: event.createdAt,
              })),
            };
          }),
        }));
        if (detail.run.status === 'passed' || detail.run.status === 'failed') {
          set({ runState: detail.run.status });
          break;
        }
      }
    } catch (reason) {
      set({ runState: 'failed', error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      runningRef.current = false;
    }
  },
}));
