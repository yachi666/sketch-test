import type { ExecutionLog, RunState, WorkflowStep } from '../types';
import { create } from 'zustand';
import { initialLogs, initialSteps, makeLogs, workflowStepsMap, workflows } from '../data';
import {
  LS_ACTIVE_WORKFLOW_KEY,
  LS_WORKFLOW_KEY,
  lsGet,
  lsGetJSON,
  lsSet,
  lsSetJSON,
} from '../lib/storage';
import { cpClient, type Workflow } from '../lib/cp-client';

const FIXTURE_BASE = 'http://localhost:3800';

interface WorkflowState {
  activeWorkflowId: string | null;
  steps: WorkflowStep[];
  selectedId: string;
  logs: ExecutionLog[];
  runState: RunState;
  runningRef: { current: boolean };
  currentRunId: string | null;
  /** Workflows fetched from CP. */
  cpWorkflows: Workflow[];
  loading: boolean;
  error: string | null;

  setActiveWorkflowId: (id: string | null) => void;
  setSteps: (stepsOrUpdater: WorkflowStep[] | ((prev: WorkflowStep[]) => WorkflowStep[])) => void;
  setSelectedId: (id: string) => void;
  setLogs: (updater: ExecutionLog[] | ((prev: ExecutionLog[]) => ExecutionLog[])) => void;
  setRunState: (state: RunState) => void;
  openWorkflow: (workflowId: string) => void;
  backToList: () => void;
  saveDraft: () => void;
  runWorkflow: () => Promise<void>;
  /** Fetch workflows from CP. Falls back to local data. */
  fetchWorkflowsFromServer: (workspaceId?: string) => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function stepToCpFormat(step: WorkflowStep) {
  return {
    method: step.method,
    url: `${FIXTURE_BASE}${step.path}`,
    headers:
      step.method === 'POST' || step.method === 'PUT' || step.method === 'PATCH'
        ? { 'Content-Type': 'application/json' }
        : undefined,
    assertions: [
      { target: 'status' as const, operator: 'equals' as const, expected: step.expectedStatus },
      ...(step.assertion
        ? [
            {
              target: 'jsonPath' as const,
              path: step.assertion.split(' ')[0] ?? step.assertion,
              operator: 'exists' as const,
            },
          ]
        : []),
    ],
    extractions: step.variableName
      ? [
          {
            name: step.variableName,
            source: 'body' as const,
            expression: step.variablePath || '$.data',
            sensitive: false,
          },
        ]
      : undefined,
  };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  activeWorkflowId: (() => {
    try {
      const stored = lsGet(LS_ACTIVE_WORKFLOW_KEY);
      if (stored) return stored;
    } catch {
      // ignore
    }
    return null;
  })(),

  cpWorkflows: [],
  loading: false,
  error: null,

  steps: lsGetJSON<WorkflowStep[]>(LS_WORKFLOW_KEY, initialSteps, (parsed) =>
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every((s) => s && typeof s === 'object' && 'id' in s)
      ? (parsed as WorkflowStep[])
      : null,
  ),

  selectedId: (() => {
    try {
      const stored = lsGet(LS_WORKFLOW_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first = parsed[0] as Record<string, unknown>;
          if (first && typeof first['id'] === 'string') return first['id'];
        }
      }
    } catch {
      // ignore
    }
    return initialSteps[2].id;
  })(),

  logs: initialLogs,
  runState: 'idle' as RunState,
  runningRef: { current: false },
  currentRunId: null,

  setActiveWorkflowId: (id) => set({ activeWorkflowId: id }),
  setSteps: (stepsOrUpdater) =>
    set((state) => ({
      steps:
        typeof stepsOrUpdater === 'function'
          ? (stepsOrUpdater as (prev: WorkflowStep[]) => WorkflowStep[])(state.steps)
          : stepsOrUpdater,
    })),
  setSelectedId: (id) => set({ selectedId: id }),
  setLogs: (updater) =>
    set((state) => ({
      logs: typeof updater === 'function' ? updater(state.logs) : updater,
    })),
  setRunState: (runState) => set({ runState }),

  openWorkflow: (workflowId: string) => {
    const wf = workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    const wfSteps = workflowStepsMap[workflowId] ?? initialSteps;
    set({
      activeWorkflowId: workflowId,
      steps: wfSteps,
      selectedId: wfSteps[0].id,
      logs: makeLogs(wfSteps),
      runState: 'idle',
    });
  },

  backToList: () => {
    set({ activeWorkflowId: null, runState: 'idle' });
  },

  saveDraft: () => {
    const { steps, activeWorkflowId } = get();
    lsSetJSON(LS_WORKFLOW_KEY, steps);
    lsSet(LS_ACTIVE_WORKFLOW_KEY, activeWorkflowId ?? '');
  },

  runWorkflow: async () => {
    const { runningRef, steps } = get();
    if (runningRef.current) return;
    runningRef.current = true;

    set({ runState: 'running', currentRunId: null });

    // Map current steps to CP API format
    const cpSteps = steps.map(stepToCpFormat);

    try {
      // Create run on CP
      const { runId } = await cpClient.createCustomRun(cpSteps);
      set({ currentRunId: runId });

      // Set all logs to running
      set((state) => ({
        logs: state.logs.map((log) => ({ ...log, status: 'running' as const })),
      }));

      // Poll for completion (max 30s)
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        const detail = await cpClient.getRun(runId);

        // Update logs from step events
        const stepEvents = detail.steps;
        const stepStatuses = new Map<number, string>();

        for (const evt of stepEvents) {
          if (evt.eventType === 'step.finished') {
            const payload = evt.payload as Record<string, unknown>;
            stepStatuses.set(evt.stepIndex, (payload?.['status'] as string) ?? 'error');
          }
        }

        set((state) => ({
          logs: state.logs.map((log, idx) => {
            const status = stepStatuses.get(idx);
            if (status) {
              return {
                ...log,
                status: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'running',
                timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
              };
            }
            return log;
          }),
        }));

        const finalStatus = detail.run.status;
        if (finalStatus === 'passed') {
          set({ runState: 'passed' });
          break;
        }
        if (finalStatus === 'failed') {
          set({ runState: 'failed' });
          break;
        }
      }
    } catch (err) {
      console.error('[workflow] CP execution failed:', err);
      set({ runState: 'failed' });
    }

    runningRef.current = false;
  },

  fetchWorkflowsFromServer: async (workspaceId?: string) => {
    set({ loading: true, error: null });
    try {
      const { workflows: cpWfs } = await cpClient.listWorkflows(workspaceId);
      set({ cpWorkflows: cpWfs, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
}));
