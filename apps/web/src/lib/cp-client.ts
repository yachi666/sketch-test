/**
 * Control Plane API client — connects Web UI to the Control Plane REST API.
 *
 * Covers M0–M2 endpoints: import, runs, IAM, environments, secrets,
 * test cases, generation, workflows, datasets, test suites, policies.
 *
 * Uses localStorage as fallback when CP is unreachable (offline dev mode).
 */

const CP_BASE = import.meta.env.VITE_CP_BASE ?? 'http://localhost:3802';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${CP_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// ── Shared Types ──

export interface ImportResult {
  apiVersionId: string;
  endpointCount: number;
  diagnostics: Array<{ level: string; message: string }>;
}

export interface RunSummary {
  id: string;
  apiVersionId: string;
  status: string;
  runnerId: string | null;
  claimedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunDetail {
  run: RunSummary;
  steps: Array<{
    stepIndex: number;
    eventType: string;
    payload: unknown;
    createdAt: string;
  }>;
}

export interface RunReport {
  run: RunSummary;
  steps: Array<{
    stepIndex: number;
    status: 'passed' | 'failed' | 'error' | 'unknown';
    durationMs?: number;
    events: Array<{ eventType: string; payload: unknown; timestamp: string }>;
  }>;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'maintainer' | 'editor' | 'viewer';
  workspaceId: string;
}

export interface Environment {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  createdAt: string;
}

export interface EnvironmentVersion {
  id: string;
  environmentId: string;
  version: number;
  baseUrl: string;
  variables: Record<string, string>;
  runnerLabels: string[];
  requireApproval: boolean;
  createdAt: string;
}

export interface Secret {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  apiVersionId: string | null;
  latestVersion?: TestCaseVersion;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseVersion {
  id: string;
  testCaseId: string;
  version: number;
  definition: Record<string, unknown>;
  sideEffect: string;
  publishedBy: string | null;
  publishedAt: string;
}

export interface Runner {
  id: string;
  name: string;
  version: string;
  labels: string[];
  status: 'online' | 'offline' | 'draining';
  lastHeartbeat: string | null;
  createdAt: string;
}

export interface GenerationJob {
  id: string;
  apiVersionId: string;
  strategy: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

export interface Draft {
  id: string;
  jobId: string;
  definition: Record<string, unknown>;
  sourceInfo: Record<string, unknown>;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  definition: Record<string, unknown>;
  compiledPlan: unknown | null;
  publishedAt: string;
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
}

// ── API Client ──

export const cpClient = {
  // ── Auth ──

  login(
    email: string,
    password: string,
    workspaceId?: string,
  ): Promise<{ user: User; token: string }> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, workspaceId }),
    });
  },

  getMe(token: string): Promise<User> {
    return request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  // ── Workspaces ──

  createWorkspace(name: string, description?: string) {
    return request<{ workspace: Workspace; admin: User }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  },

  listWorkspaces() {
    return request<{ workspaces: Workspace[] }>('/api/workspaces');
  },

  getWorkspace(id: string) {
    return request<Workspace>(`/api/workspaces/${id}`);
  },

  // ── Users ──

  listUsers(workspaceId: string) {
    return request<{ users: User[] }>(`/api/workspaces/${workspaceId}/users`);
  },

  createUser(
    workspaceId: string,
    email: string,
    password: string,
    displayName?: string,
    role?: string,
  ) {
    return request<User>(`/api/workspaces/${workspaceId}/users`, {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, role }),
    });
  },

  // ── API Import ──

  importSpec(sourceType: 'file' | 'url', sourceLocation: string, workspaceId?: string) {
    return request<ImportResult>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ sourceType, sourceLocation, workspaceId }),
    });
  },

  listApiVersions() {
    return request<{ apiVersions: unknown[] }>('/api/api-versions');
  },

  getApiVersion(id: string) {
    return request<{
      id: string;
      sourceType: string;
      sourceLocation: string;
      contentHash: string;
      createdAt: string;
      endpoints: unknown[];
      schemas: unknown;
      diagnostics: unknown[];
      servers: unknown[];
    }>(`/api/api-versions/${id}`);
  },

  diffApiVersions(baseId: string, targetId: string) {
    return request<{ changes: unknown[] }>(`/api/api-versions/${targetId}/diff?baseId=${baseId}`);
  },

  // ── Runs ──

  createRun(apiVersionId: string) {
    return request<{ runId: string; plan: unknown }>(
      `/api/api-versions/${apiVersionId}/execution-plan`,
    );
  },

  createCustomRun(
    steps: Array<{
      method: string;
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
      assertions?: Array<{
        description?: string;
        target: string;
        path?: string;
        operator: string;
        expected?: unknown;
        severity?: string;
      }>;
      extractions?: Array<{
        name: string;
        source: string;
        expression: string;
        sensitive?: boolean;
      }>;
      timeoutMs?: number;
    }>,
  ) {
    return request<{ runId: string; plan: unknown }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify({ steps }),
    });
  },

  listRuns(status?: string) {
    const qs = status ? `?status=${status}` : '';
    return request<{ runs: RunSummary[] }>(`/api/runs${qs}`);
  },

  getRun(runId: string) {
    return request<RunDetail>(`/api/runs/${runId}`);
  },

  getReport(runId: string) {
    return request<RunReport>(`/api/runs/${runId}/report`);
  },

  cancelRun(runId: string) {
    return request<{ status: string }>(`/api/runs/${runId}/cancel`, { method: 'POST' });
  },

  // ── Environments ──

  createEnvironment(workspaceId: string, name: string, description?: string) {
    return request<Environment>('/api/environments', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listEnvironments(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ environments: Environment[] }>(`/api/environments${qs}`);
  },

  getEnvironment(id: string) {
    return request<Environment>(`/api/environments/${id}`);
  },

  updateEnvironment(id: string, data: { name?: string; description?: string }) {
    return request<Environment>(`/api/environments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteEnvironment(id: string) {
    return request<void>(`/api/environments/${id}`, { method: 'DELETE' });
  },

  createEnvironmentVersion(
    environmentId: string,
    data: {
      baseUrl: string;
      variables?: Record<string, string>;
      runnerLabels?: string[];
      requireApproval?: boolean;
    },
  ) {
    return request<EnvironmentVersion>(`/api/environments/${environmentId}/versions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  listEnvironmentVersions(environmentId: string) {
    return request<{ versions: EnvironmentVersion[] }>(
      `/api/environments/${environmentId}/versions`,
    );
  },

  getEnvironmentVersion(versionId: string) {
    return request<EnvironmentVersion>(`/api/environment-versions/${versionId}`);
  },

  // ── Secrets ──

  createSecret(workspaceId: string, name: string, value: string, description?: string) {
    return request<Secret>('/api/secrets', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, value, description }),
    });
  },

  listSecrets(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ secrets: Secret[] }>(`/api/secrets${qs}`);
  },

  updateSecret(id: string, value: string) {
    return request<Secret>(`/api/secrets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    });
  },

  deleteSecret(id: string) {
    return request<void>(`/api/secrets/${id}`, { method: 'DELETE' });
  },

  // ── Test Cases ──

  createTestCase(workspaceId: string, name: string, apiVersionId?: string, description?: string) {
    return request<TestCase>('/api/test-cases', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, apiVersionId, description }),
    });
  },

  listTestCases(workspaceId?: string, apiVersionId?: string) {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (apiVersionId) params.set('apiVersionId', apiVersionId);
    return request<{ testCases: TestCase[] }>(`/api/test-cases?${params.toString()}`);
  },

  getTestCase(id: string) {
    return request<TestCase>(`/api/test-cases/${id}`);
  },

  updateTestCase(id: string, data: { name?: string; description?: string }) {
    return request<TestCase>(`/api/test-cases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteTestCase(id: string) {
    return request<void>(`/api/test-cases/${id}`, { method: 'DELETE' });
  },

  saveDraft(testCaseId: string, definition: Record<string, unknown>) {
    return request<TestCaseVersion>(`/api/test-cases/${testCaseId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ definition }),
    });
  },

  listTestCaseVersions(testCaseId: string) {
    return request<{ versions: TestCaseVersion[] }>(`/api/test-cases/${testCaseId}/versions`);
  },

  getTestCaseVersion(versionId: string) {
    return request<TestCaseVersion>(`/api/test-case-versions/${versionId}`);
  },

  publishVersion(versionId: string, publishedBy?: string) {
    return request<TestCaseVersion>(`/api/test-case-versions/${versionId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publishedBy }),
    });
  },

  compareVersions(versionIdA: string, versionIdB: string) {
    return request<{ diff: unknown }>(
      `/api/test-case-versions/compare?a=${versionIdA}&b=${versionIdB}`,
    );
  },

  // ── Generation ──

  startGeneration(
    workspaceId: string,
    apiVersionId: string,
    strategy: string,
    endpointIds?: string[],
  ) {
    return request<GenerationJob>('/api/generation-jobs', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, apiVersionId, strategy, endpointIds }),
    });
  },

  listGenerationJobs(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ jobs: GenerationJob[] }>(`/api/generation-jobs${qs}`);
  },

  getGenerationJob(jobId: string) {
    return request<GenerationJob>(`/api/generation-jobs/${jobId}`);
  },

  listDrafts(jobId: string) {
    return request<{ drafts: Draft[] }>(`/api/generation-jobs/${jobId}/drafts`);
  },

  getDraft(draftId: string) {
    return request<Draft>(`/api/drafts/${draftId}`);
  },

  acceptDraft(draftId: string, reviewedBy?: string, modifications?: Record<string, unknown>) {
    return request<{ testCaseVersion: TestCaseVersion }>(`/api/drafts/${draftId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ reviewedBy, modifications }),
    });
  },

  rejectDraft(draftId: string, reason?: string) {
    return request<{ status: string }>(`/api/drafts/${draftId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  // ── Runners ──

  listRunners(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ runners: Runner[] }>(`/api/runners${qs}`);
  },

  getRunner(id: string) {
    return request<Runner>(`/api/runners/${id}`);
  },

  updateRunnerStatus(id: string, status: string) {
    return request<Runner>(`/api/runners/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  deleteRunner(id: string) {
    return request<void>(`/api/runners/${id}`, { method: 'DELETE' });
  },

  // ── Workflows ──

  createWorkflow(workspaceId: string, name: string, description?: string) {
    return request<Workflow>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listWorkflows(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ workflows: Workflow[] }>(`/api/workflows${qs}`);
  },

  getWorkflow(id: string) {
    return request<Workflow>(`/api/workflows/${id}`);
  },

  deleteWorkflow(id: string) {
    return request<void>(`/api/workflows/${id}`, { method: 'DELETE' });
  },

  saveWorkflowDraft(workflowId: string, definition: Record<string, unknown>) {
    return request<WorkflowVersion>(`/api/workflows/${workflowId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ definition }),
    });
  },

  listWorkflowVersions(workflowId: string) {
    return request<{ versions: WorkflowVersion[] }>(`/api/workflows/${workflowId}/versions`);
  },

  publishWorkflowVersion(versionId: string) {
    return request<WorkflowVersion>(`/api/workflow-versions/${versionId}/publish`, {
      method: 'POST',
    });
  },

  // ── Test Suites ──

  createTestSuite(workspaceId: string, name: string, description?: string) {
    return request<TestSuite>('/api/test-suites', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listTestSuites(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ testSuites: TestSuite[] }>(`/api/test-suites${qs}`);
  },

  createTestSuiteVersion(
    testSuiteId: string,
    members: string[],
    qualityGate: Record<string, unknown>,
  ) {
    return request<{ id: string; version: number }>(`/api/test-suites/${testSuiteId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ members, qualityGate }),
    });
  },

  // ── Datasets ──

  createDataset(workspaceId: string, name: string, description?: string) {
    return request<Dataset>('/api/datasets', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listDatasets(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ datasets: Dataset[] }>(`/api/datasets${qs}`);
  },

  // ── Policies ──

  createPolicy(workspaceId: string, name: string, rules: unknown[], priority?: number) {
    return request<{ id: string }>('/api/policies', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, rules, priority }),
    });
  },

  listPolicies(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ policies: unknown[] }>(`/api/policies${qs}`);
  },
};
