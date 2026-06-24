import { create } from 'zustand';
import {
  lsGet,
  lsGetJSON,
  lsSet,
  lsSetJSON,
  LS_ACTIVE_ENV_KEY,
  LS_ENVIRONMENTS_KEY,
} from '../lib/storage';
import { initialEnvironments } from '../data';
import type { Environment } from '../types';
import { cpClient, type EnvironmentVersion } from '../lib/cp-client';
import { useVariableStore } from './variableStore';

interface EnvironmentState {
  environments: Environment[];
  activeEnvironmentId: string;
  /** Latest environment versions fetched from CP, keyed by environmentId. */
  versions: Record<string, EnvironmentVersion[]>;
  loading: boolean;
  error: string | null;

  setActiveEnvironmentId: (id: string) => void;
  createEnvironment: (env: Environment) => void;
  updateEnvironment: (env: Environment) => void;
  deleteEnvironment: (envId: string) => void;

  /** Fetch environments + versions from CP. Falls back to localStorage on error. */
  fetchFromServer: (workspaceId?: string) => Promise<void>;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: lsGetJSON<Environment[]>(LS_ENVIRONMENTS_KEY, initialEnvironments, (parsed) =>
    Array.isArray(parsed) &&
    parsed.every((e) => e && typeof e === 'object' && 'id' in e && 'name' in e)
      ? (parsed as Environment[])
      : null,
  ),

  activeEnvironmentId: (() => {
    try {
      const stored = lsGet(LS_ACTIVE_ENV_KEY);
      if (stored) return stored;
    } catch {
      // ignore
    }
    return initialEnvironments[0].id;
  })(),

  versions: {},
  loading: false,
  error: null,

  setActiveEnvironmentId: (id) => {
    lsSet(LS_ACTIVE_ENV_KEY, id);
    set({ activeEnvironmentId: id });
  },

  createEnvironment: (env) =>
    set((state) => {
      const next = [env, ...state.environments];
      lsSetJSON(LS_ENVIRONMENTS_KEY, next);
      return { environments: next };
    }),

  updateEnvironment: (env) =>
    set((state) => {
      const next = state.environments.map((x) => (x.id === env.id ? env : x));
      lsSetJSON(LS_ENVIRONMENTS_KEY, next);
      return { environments: next };
    }),

  deleteEnvironment: (envId) =>
    set((state) => {
      const next = state.environments.filter((x) => x.id !== envId);
      lsSetJSON(LS_ENVIRONMENTS_KEY, next);

      const newActiveId =
        state.activeEnvironmentId === envId && next.length > 0
          ? next[0].id
          : state.activeEnvironmentId;
      if (newActiveId !== state.activeEnvironmentId) {
        lsSet(LS_ACTIVE_ENV_KEY, newActiveId);
      }

      const variableStore = useVariableStore.getState();
      const vars = variableStore.variables;
      const cleaned = vars.map((v) => {
        const newOverrides = { ...v.overrides };
        delete newOverrides[envId];
        return { ...v, overrides: newOverrides };
      });
      variableStore.setVariables(cleaned);
      lsSetJSON('sketchtest.variables:v1', cleaned);

      return { environments: next, activeEnvironmentId: newActiveId };
    }),

  fetchFromServer: async (workspaceId?: string) => {
    set({ loading: true, error: null });
    try {
      const { environments } = await cpClient.listEnvironments(workspaceId);
      // Map CP environment shape to local Environment type
      const mapped: Environment[] = environments.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description ?? '',
        baseUrl: '',
        variables: {},
        createdAt: e.createdAt,
        updatedAt: e.createdAt,
      }));

      // Fetch versions for each environment
      const versionsMap: Record<string, EnvironmentVersion[]> = {};
      for (const env of environments) {
        try {
          const { versions } = await cpClient.listEnvironmentVersions(env.id);
          versionsMap[env.id] = versions;
          // Set baseUrl and variables from latest version
          const latest = versions[versions.length - 1];
          if (latest) {
            const idx = mapped.findIndex((m) => m.id === env.id);
            if (idx >= 0) {
              mapped[idx] = {
                ...mapped[idx],
                baseUrl: latest.baseUrl,
                variables: latest.variables ?? {},
              };
            }
          }
        } catch {
          // Skip version fetch for this env
        }
      }

      set({ environments: mapped, versions: versionsMap, loading: false });
      // Persist to localStorage as cache
      lsSetJSON(LS_ENVIRONMENTS_KEY, mapped);
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
}));
