import { create } from 'zustand';
import { loadApiSources, deleteApiSource, loadAllEndpoints } from '../lib/storage';
import {
  endpoints as defaultEndpoints,
  endpointDetails,
  apiSchemas,
  apiSources as initialApiSources,
} from '../data';
import type { ApiEndpoint, ApiSource, EndpointDetail, SchemaDisplayNode } from '../types';
import { cpClient } from '../lib/cp-client';

interface ApiState {
  imported: boolean;
  apiEndpoints: ApiEndpoint[];
  apiDetails: Record<string, EndpointDetail>;
  apiSchemas: Record<string, SchemaDisplayNode>;
  apiSources: ApiSource[];
  sourceDialogOpen: boolean;
  editingSource: ApiSource | null;
  manageSourcesOpen: boolean;
  sourceToDelete: ApiSource | null;
  /** API versions from CP, keyed by versionId. */
  apiVersions: Array<{
    id: string;
    sourceType: string;
    sourceLocation: string;
    contentHash: string;
    createdAt: string;
    endpointCount?: number;
  }>;
  loading: boolean;
  error: string | null;

  setImported: (v: boolean) => void;
  createEndpoint: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  updateEndpoint: (endpoint: ApiEndpoint, detail: EndpointDetail) => void;
  deleteEndpoint: (endpointId: string) => void;
  createSchema: (schema: SchemaDisplayNode) => void;

  setSourceDialogOpen: (open: boolean) => void;
  setEditingSource: (source: ApiSource | null) => void;
  setManageSourcesOpen: (open: boolean) => void;
  setSourceToDelete: (source: ApiSource | null) => void;
  openSourceDialog: (source: ApiSource | null) => void;
  saveSource: (saved: ApiSource) => void;
  confirmDeleteSource: () => void;

  /** Fetch API versions from CP. */
  fetchApiVersions: () => Promise<void>;
}

export const useApiStore = create<ApiState>((set, get) => ({
  imported: false,
  apiEndpoints: defaultEndpoints,
  apiDetails: endpointDetails,
  apiSchemas,
  apiSources: (() => {
    const stored = loadApiSources();
    if (stored.length > 0) return stored as ApiSource[];
    return initialApiSources as ApiSource[];
  })(),
  sourceDialogOpen: false,
  editingSource: null,
  manageSourcesOpen: false,
  sourceToDelete: null,
  apiVersions: [],
  loading: false,
  error: null,

  setImported: (imported) => set({ imported }),

  createEndpoint: (endpoint, detail) =>
    set((state) => ({
      apiEndpoints: [...state.apiEndpoints, endpoint],
      apiDetails: { ...state.apiDetails, [endpoint.id]: detail },
    })),

  updateEndpoint: (endpoint, detail) =>
    set((state) => ({
      apiEndpoints: state.apiEndpoints.map((ep) =>
        ep.id === endpoint.id ? { ...ep, ...endpoint } : ep,
      ),
      apiDetails: { ...state.apiDetails, [endpoint.id]: detail },
    })),

  deleteEndpoint: (endpointId) =>
    set((state) => {
      const next = { ...state.apiDetails };
      delete next[endpointId];
      return {
        apiEndpoints: state.apiEndpoints.filter((ep) => ep.id !== endpointId),
        apiDetails: next,
      };
    }),

  createSchema: (schema) =>
    set((state) => ({
      apiSchemas: { ...state.apiSchemas, [schema.id]: schema },
    })),

  setSourceDialogOpen: (sourceDialogOpen) => set({ sourceDialogOpen }),
  setEditingSource: (editingSource) => set({ editingSource }),
  setManageSourcesOpen: (manageSourcesOpen) => set({ manageSourcesOpen }),
  setSourceToDelete: (sourceToDelete) => set({ sourceToDelete }),

  openSourceDialog: (source) => set({ editingSource: source, sourceDialogOpen: true }),

  saveSource: (saved) =>
    set((state) => {
      const idx = state.apiSources.findIndex((s) => s.id === saved.id);
      const apiSources =
        idx >= 0
          ? state.apiSources.map((s) => (s.id === saved.id ? saved : s))
          : [...state.apiSources, saved];
      return { apiSources };
    }),

  confirmDeleteSource: () => {
    const { sourceToDelete } = get();
    if (!sourceToDelete) return;
    deleteApiSource(sourceToDelete.id);
    set((state) => ({
      apiSources: state.apiSources.filter((s) => s.id !== sourceToDelete.id),
      sourceToDelete: null,
    }));
  },

  fetchApiVersions: async () => {
    set({ loading: true, error: null });
    try {
      const { apiVersions } = await cpClient.listApiVersions();
      const mapped = apiVersions.map((v: Record<string, unknown>) => ({
        id: v['id'] as string,
        sourceType: v['source_type'] as string,
        sourceLocation: v['source_location'] as string,
        contentHash: v['content_hash'] as string,
        createdAt: v['created_at'] as string,
        endpointCount: v['endpoint_count'] as number | undefined,
      }));
      set({ apiVersions: mapped, loading: false, imported: mapped.length > 0 });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },
}));
