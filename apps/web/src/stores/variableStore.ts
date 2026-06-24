import { create } from 'zustand';
import { lsGetJSON, lsSetJSON, LS_VARIABLES_KEY } from '../lib/storage';
import { initialVariables } from '../data';
import type { Variable } from '../types';
import { cpClient, type Secret } from '../lib/cp-client';

interface VariableState {
  variables: Variable[];
  /** Secrets fetched from CP (with encrypted_value hidden). */
  secrets: Secret[];
  loading: boolean;
  error: string | null;

  setVariables: (variables: Variable[]) => void;
  createVariable: (v: Variable) => void;
  updateVariable: (v: Variable) => void;
  deleteVariable: (id: string) => void;

  /** Fetch secrets from CP. Falls back silently on error. */
  fetchSecretsFromServer: (workspaceId?: string) => Promise<void>;
}

export const useVariableStore = create<VariableState>((set) => ({
  variables: lsGetJSON<Variable[]>(LS_VARIABLES_KEY, initialVariables, (parsed) => {
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as Record<string, unknown>;
      if ('value' in first && !('defaultValue' in first)) {
        return (parsed as Array<Record<string, unknown>>).map((v) => ({
          ...v,
          defaultValue: typeof v['value'] === 'string' ? (v['value'] as string) : '',
          overrides:
            v['overrides'] && typeof v['overrides'] === 'object'
              ? (v['overrides'] as Record<string, string>)
              : {},
          tags: Array.isArray(v['tags']) ? v['tags'] : [],
        })) as Variable[];
      }
      if (!('tags' in first)) {
        return (parsed as Array<Record<string, unknown>>).map((v) => ({
          ...v,
          tags: Array.isArray(v['tags']) ? v['tags'] : [],
        })) as Variable[];
      }
    }
    return parsed as Variable[];
  }),

  secrets: [],
  loading: false,
  error: null,

  setVariables: (variables) => set({ variables }),

  createVariable: (v) =>
    set((state) => {
      const next = [v, ...state.variables];
      lsSetJSON(LS_VARIABLES_KEY, next);
      return { variables: next };
    }),

  updateVariable: (v) =>
    set((state) => {
      const next = state.variables.map((x) => (x.id === v.id ? v : x));
      lsSetJSON(LS_VARIABLES_KEY, next);
      return { variables: next };
    }),

  deleteVariable: (id) =>
    set((state) => {
      const next = state.variables.filter((x) => x.id !== id);
      lsSetJSON(LS_VARIABLES_KEY, next);
      return { variables: next };
    }),

  fetchSecretsFromServer: async (workspaceId?: string) => {
    set({ loading: true, error: null });
    try {
      const { secrets } = await cpClient.listSecrets(workspaceId);
      set({ secrets, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
}));
