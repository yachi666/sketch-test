import { create } from 'zustand';
import { cpClient, type EnvironmentVersion } from '../lib/cp-client';
import type { Environment } from '../types';

interface EnvironmentState {
  environments: Environment[];
  activeEnvironmentId: string;
  versions: Record<string, EnvironmentVersion[]>;
  loading: boolean;
  error: string | null;
  setActiveEnvironmentId: (id: string) => void;
  createEnvironment: (
    workspaceId: string,
    name?: string,
    description?: string,
  ) => Promise<Environment | null>;
  updateEnvironment: (
    id: string,
    name?: string,
    description?: string,
  ) => Promise<Environment | null>;
  deleteEnvironment: (id: string) => Promise<boolean>;
  fetchFromServer: (workspaceId: string) => Promise<void>;
}

function asUiEnvironment(item: {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}): Environment {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    tags: [],
    isProduction: false,
    updatedAt: item.createdAt,
    updatedBy: 'Control Plane',
  };
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  activeEnvironmentId: '',
  versions: {},
  loading: false,
  error: null,
  setActiveEnvironmentId: (activeEnvironmentId) => set({ activeEnvironmentId }),
  fetchFromServer: async (workspaceId) => {
    set({ loading: true, error: null });
    try {
      const { environments } = await cpClient.listEnvironments(workspaceId);
      const versions = Object.fromEntries(
        await Promise.all(
          environments.map(
            async (environment) =>
              [
                environment.id,
                (await cpClient.listEnvironmentVersions(environment.id)).versions,
              ] as const,
          ),
        ),
      );
      const mapped = environments.map(asUiEnvironment);
      set({
        environments: mapped,
        versions,
        activeEnvironmentId: get().activeEnvironmentId || mapped[0]?.id || '',
        loading: false,
      });
    } catch (reason) {
      set({ loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    }
  },
  createEnvironment: async (workspaceId, name, description) => {
    if (!name) {
      set({ error: '环境名称不能为空。' });
      return null;
    }
    try {
      const created = asUiEnvironment(
        await cpClient.createEnvironment(workspaceId, name, description),
      );
      set((state) => ({
        environments: [created, ...state.environments],
        activeEnvironmentId: state.activeEnvironmentId || created.id,
      }));
      return created;
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  },
  updateEnvironment: async (id, name, description) => {
    if (!name) {
      set({ error: '环境名称不能为空。' });
      return null;
    }
    try {
      const updated = asUiEnvironment(await cpClient.updateEnvironment(id, { name, description }));
      set((state) => ({
        environments: state.environments.map((item) => (item.id === id ? updated : item)),
      }));
      return updated;
    } catch (reason) {
      set({ error: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  },
  deleteEnvironment: async (id) => {
    const previous = get().environments;
    const previousActiveId = get().activeEnvironmentId;
    const environments = previous.filter((item) => item.id !== id);
    set({
      environments,
      activeEnvironmentId:
        get().activeEnvironmentId === id ? environments[0]?.id || '' : get().activeEnvironmentId,
    });
    try {
      await cpClient.deleteEnvironment(id);
      return true;
    } catch (reason) {
      set({
        environments: previous,
        activeEnvironmentId: previousActiveId,
        error: reason instanceof Error ? reason.message : String(reason),
      });
      return false;
    }
  },
}));
