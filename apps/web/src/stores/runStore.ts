import { create } from 'zustand';
import type { RunSummary } from '../lib/cp-client';
import { cpClient } from '../lib/cp-client';

interface RunState {
  runs: RunSummary[];
  activeRunId: string | null;
  loading: boolean;
  error: string | null;

  setActiveRunId: (id: string | null) => void;
  /** Fetch runs from CP. Falls back to empty list on error. */
  fetchRuns: (status?: string) => Promise<void>;
  /** Poll a run until it reaches a terminal state. Returns the final run. */
  pollRun: (runId: string, timeoutMs?: number) => Promise<RunSummary>;
}

export const useRunStore = create<RunState>((set, get) => ({
  runs: [],
  activeRunId: null,
  loading: false,
  error: null,

  setActiveRunId: (activeRunId) => set({ activeRunId }),

  fetchRuns: async (status?: string) => {
    set({ loading: true, error: null });
    try {
      const { runs } = await cpClient.listRuns(status);
      set({ runs, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  pollRun: async (runId: string, timeoutMs = 30_000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const detail = await cpClient.getRun(runId);
        const status = detail.run.status;
        // Update the run in the local list
        set((state) => ({
          runs: state.runs.map((r) => (r.id === runId ? { ...r, status } : r)),
        }));
        if (['passed', 'failed', 'inconclusive', 'cancelled'].includes(status)) {
          return detail.run;
        }
      } catch {
        // Retry on network error
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
  },
}));
