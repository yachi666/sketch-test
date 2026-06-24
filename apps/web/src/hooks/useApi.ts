/**
 * Shared hooks for fetching data from the Control Plane.
 *
 * Each hook auto-fetches on mount and exposes { data, loading, error, refetch }.
 * Uses the appropriate Zustand store or cpClient directly.
 */

import { useEffect, useCallback } from 'react';
import { useApiStore } from '../stores/apiStore';
import { useEnvironmentStore } from '../stores/environmentStore';
import { useVariableStore } from '../stores/variableStore';
import { useRunStore } from '../stores/runStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useAuthStore } from '../stores/authStore';

/**
 * Fetch API versions from CP on mount.
 * Falls back to localStorage data if CP is unreachable.
 */
export function useApiVersions() {
  const { apiVersions, loading, error, fetchApiVersions } = useApiStore();

  useEffect(() => {
    if (apiVersions.length === 0) {
      fetchApiVersions();
    }
  }, [apiVersions.length, fetchApiVersions]);

  return { data: apiVersions, loading, error, refetch: fetchApiVersions };
}

/**
 * Fetch environments from CP on mount.
 */
export function useEnvironments(workspaceId?: string) {
  const { environments, versions, loading, error, fetchFromServer } = useEnvironmentStore();

  useEffect(() => {
    fetchFromServer(workspaceId);
  }, [workspaceId, fetchFromServer]);

  return {
    data: environments,
    versions,
    loading,
    error,
    refetch: () => fetchFromServer(workspaceId),
  };
}

/**
 * Fetch secrets from CP on mount.
 */
export function useSecrets(workspaceId?: string) {
  const { secrets, loading, error, fetchSecretsFromServer } = useVariableStore();

  useEffect(() => {
    fetchSecretsFromServer(workspaceId);
  }, [workspaceId, fetchSecretsFromServer]);

  return { data: secrets, loading, error, refetch: () => fetchSecretsFromServer(workspaceId) };
}

/**
 * Fetch runs from CP with polling option.
 */
export function useRuns(pollIntervalMs?: number) {
  const { runs, loading, error, fetchRuns } = useRunStore();

  useEffect(() => {
    fetchRuns();

    if (pollIntervalMs && pollIntervalMs > 0) {
      const interval = setInterval(() => fetchRuns(), pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [fetchRuns, pollIntervalMs]);

  return { data: runs, loading, error, refetch: fetchRuns };
}

/**
 * Fetch workflows from CP on mount.
 */
export function useWorkflows(workspaceId?: string) {
  const { cpWorkflows, loading, error, fetchWorkflowsFromServer } = useWorkflowStore();

  useEffect(() => {
    fetchWorkflowsFromServer(workspaceId);
  }, [workspaceId, fetchWorkflowsFromServer]);

  return {
    data: cpWorkflows,
    loading,
    error,
    refetch: () => fetchWorkflowsFromServer(workspaceId),
  };
}

/**
 * Restore auth session on mount.
 */
export function useAuth() {
  const { user, token, loading, error, login, logout, restoreSession, isAuthenticated } =
    useAuthStore();

  useEffect(() => {
    if (token && !user) {
      restoreSession();
    }
  }, [token, user, restoreSession]);

  return { user, token, loading, error, login, logout, isAuthenticated };
}

/**
 * Generic data fetcher hook — for one-off API calls.
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refetch: () => Promise<void> } {
  const [state, setState] = (() => {
    // Simple state management without external dep
    let s = { data: null as T | null, loading: false, error: null as string | null };
    const update = (partial: Partial<typeof s>) => {
      s = { ...s, ...partial };
    };
    return { getState: () => s, setState: update };
  })();

  const execute = useCallback(async () => {
    state.loading = true;
    state.error = null;
    try {
      const result = await fetcher();
      state.data = result;
      state.loading = false;
    } catch (err) {
      state.error = String(err);
      state.loading = false;
    }
  }, deps);

  useEffect(() => {
    execute();
  }, [execute]);

  return { ...state, refetch: execute };
}
