import type {
  AgentConfig,
  AgentSnapshot,
  ConnectionConfig,
} from '@sketch-test/generation-protocol';

export type {
  AgentConfig,
  AgentSnapshot,
  ConnectionConfig,
} from '@sketch-test/generation-protocol';

import type { PlanAsset, PlanProposal } from '@sketch-test/generation-protocol';

export type { PlanAsset, PlanProposal } from '@sketch-test/generation-protocol';

/**
 * Control Plane API client — connects Web UI to the Control Plane REST API.
 *
 * Covers product endpoints: import, runs, IAM, environments, secrets,
 * test cases, generation, workflows, datasets, test suites, policies.
 *
 * Network and server failures are surfaced to callers. Production views must
 * never replace Control Plane data with browser-local sample records.
 */

import { clearAuthSession, notifyUnauthorized, storedAccessToken } from './auth-session';

const CP_BASE = import.meta.env['VITE_CP_BASE'] ?? 'http://localhost:3802';

export function getControlPlaneBaseUrl(): string {
  return CP_BASE;
}

interface RequestOptions extends RequestInit {
  auth?: boolean;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const token = options?.auth === false ? null : storedAccessToken();
  const { auth: _auth, ...fetchOptions } = options ?? {};
  const response = await fetch(`${CP_BASE}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...fetchOptions.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    if (response.status === 401 && options?.auth !== false) {
      clearAuthSession();
      notifyUnauthorized();
    }
    throw new Error(error.message ?? `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ── Shared Types ──

export interface RepositoryAnalysis extends ImportResult {
  repositoryUrl: string;
  commit: string;
  scannedFiles: number;
}

export interface ImportResult {
  apiVersionId: string;
  endpointCount: number;
  diagnostics: Array<{ level: string; message: string }>;
}

export interface ApiVersionSummary {
  id: string;
  sourceType: string;
  sourceLocation: string;
  contentHash: string;
  createdAt: string;
  label?: string;
  endpointCount: number;
  diagnosticCount: number;
}

export interface EndpointOpenApiDefinition {
  yaml: string;
  origin: 'derived-openapi' | 'derived-postman' | 'derived-canonical';
  sourceLabel: string;
  fileName: string;
}

export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  active: number;
  unresolved: number;
  cancelled: number;
  other: number;
}
export interface RunQuery {
  q?: string;
  status?: string;
  days?: number;
  page?: number;
  pageSize?: number;
}
export interface RunListResult {
  runs: RunSummary[];
  total: number;
  page: number;
  pageSize: number;
  summary: RunCounts;
}
export interface RunSummary {
  sourceName?: string;
  id: string;
  apiVersionId: string | null;
  workflowVersionId?: string | null;
  testCaseVersionId?: string | null;
  environmentVersionId?: string | null;
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
    name?: string;
    phase?: 'main' | 'teardown';
    method?: string;
    url?: string;
    assertions?: Array<{
      assertionId?: string;
      description?: string;
      passed?: boolean;
      expected?: string;
      actual?: string;
      severity?: string;
      schemaDiff?: string;
      attempt?: number;
    }>;
    error?: { type: string; message: string };
    status: 'passed' | 'failed' | 'error' | 'skipped' | 'not_run' | 'unknown';
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  config?: { objective?: string; provider?: string; model?: string; endpointIds?: string[] };
  draftCount?: number;
  coveredEndpointCount?: number;
  attempt?: number;
  errorCode?: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Draft {
  id: string;
  jobId: string;
  definition?: Record<string, unknown>;
  definitionSummary?: { name: string; sideEffect: string };
  sourceInfo: Record<string, unknown>;
  confidence: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'modified';
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  latestVersion?: WorkflowVersion | null;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  definition: Record<string, unknown>;
  compiledPlan: unknown | null;
  publishedAt: string;
}

export interface PublishedWorkflow {
  published: boolean;
  version: { id: string; workflowId: string; version: number; publishedAt: string };
  plan: { planHash: string; steps: unknown[] };
  diagnostics: Array<{ severity: string; message: string }>;
}

export interface TestSuite {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestSuiteMember {
  type: 'test' | 'workflow';
  id: string;
}

export interface QualityGateConfig {
  requiredWorkflows?: string[];
  noNewFailures?: boolean;
  maxFlakyRetries?: number;
  minEndpointCoverage?: number;
  requiredTags?: string[];
  blockOnInfraError?: boolean;
}

export interface TestSuiteVersion {
  id: string;
  testSuiteId: string;
  version: number;
  members: TestSuiteMember[];
  qualityGate: QualityGateConfig;
  createdAt: string;
}

export interface TestSuiteDetail {
  testSuite: TestSuite;
  latestVersion: TestSuiteVersion | null;
}

export interface Schedule {
  id: string;
  workspaceId: string;
  testSuiteId: string;
  cronExpression: string;
  environmentId: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface QualityGateResult {
  result: 'PASSED' | 'FAILED' | 'BLOCKED' | 'INCONCLUSIVE' | 'CANCELLED';
  reason?: string;
  details?: Record<string, unknown>;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  workspaceId: string;
}

// ── API Client ──

export interface ProviderConnection extends ConnectionConfig {
  id: string;
}
export interface AgentExecution {
  id: string;
  status: string;
  agent: AgentSnapshot | null;
  workerId: string | null;
  createdAt: string;
  completedAt: string | null;
  attempt: number;
  errorCode: string | null;
  inputHash: string | null;
  resultHash: string | null;
  modelSnapshot: string | null;
  config: { provider?: string; model?: string; objective?: string };
  events: Array<{
    id: string;
    attempt: number;
    type: string;
    createdAt: string;
    payload: {
      at?: string;
      tool?: string;
      durationMs?: number;
      success?: boolean;
      inputTokens?: number;
      outputTokens?: number;
      errorCode?: string;
    };
  }>;
  outputs: Array<{
    id: string;
    status: string;
    testCaseId: string | null;
    originalDefinition: unknown;
    sourceInfo: Record<string, unknown>;
  }>;
}
export const cpClient = {
  listAgents: () => request<{ agents: AgentSnapshot[] }>('/api/agents'),
  saveAgent: (config: AgentConfig, id?: string, expectedVersion?: number) =>
    request<{ agent: AgentSnapshot }>(id ? `/api/agents/${id}` : '/api/agents', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(id ? { config, expectedVersion } : config),
    }),
  agentVersions: (id: string) =>
    request<{ versions: Array<{ config: AgentSnapshot; createdAt: string }> }>(
      `/api/agents/${id}/versions`,
    ),
  listConnections: () =>
    request<{ connections: ProviderConnection[] }>('/api/provider-connections'),
  addConnection: (config: ConnectionConfig) =>
    request<{ connection: ProviderConnection }>('/api/provider-connections', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  checkConnection: (id: string) =>
    request<{ available: boolean; models: string[]; message: string }>(
      `/api/provider-connections/${id}/check`,
      { method: 'POST', body: '{}' },
    ),
  execution: (id: string) => request<AgentExecution>(`/api/generation-jobs/${id}/execution`),
  caseProvenance: (id: string) =>
    request<{
      sources: Array<{
        jobId: string;
        draftId: string;
        sourceInfo: Record<string, unknown>;
        reviewedAt: string | null;
      }>;
    }>(`/api/test-cases/${id}/provenance`),
  // ── Auth ──

  getGuestSession(): Promise<{ enabled: true; user: User; token: string } | { enabled: false }> {
    return request('/api/auth/guest', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({}),
    });
  },

  getMe(_token?: string): Promise<{ user: User }> {
    return request('/api/auth/me');
  },

  // ── Workspaces ──

  createWorkspace(
    name: string,
    ownerEmail: string,
    ownerPassword: string,
    description?: string,
    ownerDisplayName?: string,
  ) {
    return request<{ workspace: Workspace; adminUser: User }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name, description, ownerEmail, ownerPassword, ownerDisplayName }),
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

  importSpec(sourceType: 'url', sourceLocation: string, workspaceId?: string) {
    return request<ImportResult>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ sourceType, sourceLocation, workspaceId }),
    });
  },

  listApiVersions() {
    return request<{ apiVersions: ApiVersionSummary[] }>('/api/api-versions');
  },

  analyzeRepository(input: { repositoryUrl: string; ref?: string; directory?: string }) {
    return request<RepositoryAnalysis>('/api/import/repository', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  getApiVersion(id: string) {
    return request<{
      id: string;
      sourceType: string;
      sourceLocation: string;
      contentHash: string;
      createdAt: string;
      metadata?: { extra?: { repositoryUrl?: string; commit?: string; files?: unknown[] } };
      endpoints: unknown[];
      schemas: unknown;
      diagnostics: unknown[];
      servers: unknown[];
    }>(`/api/api-versions/${id}`);
  },

  getEndpointOpenApiDefinition(apiVersionId: string, endpointId: string) {
    return request<EndpointOpenApiDefinition>(
      `/api/api-versions/${encodeURIComponent(apiVersionId)}/endpoints/${encodeURIComponent(endpointId)}/openapi`,
    );
  },

  diffApiVersions(baseId: string, targetId: string) {
    return request<{ changes: unknown[] }>(`/api/api-versions/${targetId}/diff?baseId=${baseId}`);
  },

  // ── Runs ──

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

  listRuns(query: RunQuery | string = {}, signal?: AbortSignal) {
    const filters = typeof query === 'string' ? { status: query } : query;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    return request<RunListResult>(`/api/runs?${params}`, { signal });
  },

  getRun(runId: string) {
    return request<RunDetail>(`/api/runs/${runId}`);
  },

  getReport(runId: string, signal?: AbortSignal) {
    return request<RunReport>(`/api/runs/${runId}/report`, { signal });
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

  runPublishedTest(versionId: string, environmentVersionId: string, confirmSideEffects = false) {
    return request<{ runId: string }>(`/api/test-case-versions/${versionId}/run`, {
      method: 'POST',
      body: JSON.stringify({ environmentVersionId, confirmSideEffects }),
    });
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
    objective?: string,
    agentId?: string,
  ) {
    return request<GenerationJob>('/api/generation-jobs', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        apiVersionId,
        strategy,
        endpointIds,
        objective,
        agentId,
      }),
    });
  },

  aiCapabilities() {
    return request<{
      configured: boolean;
      available: boolean;
      workers: Array<{
        workerId: string;
        provider: string;
        model: string;
        harnessVersion: string;
        connectionRef?: string;
        agentConfigVersion?: 1;
      }>;
    }>('/api/ai/capabilities');
  },

  changeGeneration(jobId: string, action: 'cancel' | 'retry') {
    return request<{ ok: true }>(`/api/generation-jobs/${jobId}/${action}`, {
      method: 'POST',
      body: '{}',
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
    return request<{
      testCaseId: string;
      versionId: string;
      version: number;
      draft: { id: string; status: string };
    }>(`/api/drafts/${draftId}/accept`, {
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
    return request<{ workflow: Workflow }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listWorkflows(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ workflows: Workflow[] }>(`/api/workflows${qs}`);
  },

  getWorkflow(id: string) {
    return request<{ workflow: Workflow }>(`/api/workflows/${id}`);
  },

  updateWorkflow(id: string, data: { name?: string; description?: string }) {
    return request<{ workflow: Workflow }>(`/api/workflows/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteWorkflow(id: string) {
    return request<void>(`/api/workflows/${id}`, { method: 'DELETE' });
  },

  saveWorkflowDraft(workflowId: string, definition: Record<string, unknown>) {
    return request<{ version: WorkflowVersion }>(`/api/workflows/${workflowId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ definition }),
    });
  },

  listWorkflowVersions(workflowId: string) {
    return request<{ versions: WorkflowVersion[] }>(`/api/workflows/${workflowId}/versions`);
  },

  publishWorkflowVersion(versionId: string) {
    return request<PublishedWorkflow>(`/api/workflow-versions/${versionId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ publishedBy: 'web' }),
    });
  },

  createRunFromWorkflow(workflowVersionId: string) {
    return request<{ runId: string; workflowVersionId: string; plan: unknown }>(
      '/api/runs/from-workflow',
      { method: 'POST', body: JSON.stringify({ workflowVersionId }) },
    );
  },

  // ── Test Suites ──

  createTestSuite(workspaceId: string, name: string, description?: string) {
    return request<{ testSuite: TestSuite }>('/api/test-suites', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, name, description }),
    });
  },

  listTestSuites(workspaceId?: string) {
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ testSuites: TestSuite[] }>(`/api/test-suites${qs}`);
  },

  getTestSuite(testSuiteId: string) {
    return request<TestSuiteDetail>(`/api/test-suites/${testSuiteId}`);
  },

  deleteTestSuite(testSuiteId: string) {
    return request<void>(`/api/test-suites/${testSuiteId}`, { method: 'DELETE' });
  },

  createTestSuiteVersion(
    testSuiteId: string,
    members: TestSuiteMember[],
    qualityGate: QualityGateConfig,
  ) {
    return request<{ version: TestSuiteVersion }>(`/api/test-suites/${testSuiteId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ members, qualityGate }),
    });
  },

  listTestSuiteVersions(testSuiteId: string) {
    return request<{ versions: TestSuiteVersion[] }>(`/api/test-suites/${testSuiteId}/versions`);
  },

  getTestSuiteVersion(versionId: string) {
    return request<{ version: TestSuiteVersion }>(`/api/test-suite-versions/${versionId}`);
  },

  evaluateQualityGate(versionId: string, runId: string) {
    return request<QualityGateResult>(`/api/test-suite-versions/${versionId}/evaluate`, {
      method: 'POST',
      body: JSON.stringify({ runId }),
    });
  },

  // ── Schedules ──

  createSchedule(
    workspaceId: string,
    testSuiteId: string,
    cronExpression: string,
    enabled = true,
    environmentId?: string,
  ) {
    return request<Schedule>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        testSuiteId,
        cronExpression,
        enabled,
        environmentId,
      }),
    });
  },

  listSchedules() {
    return request<{ schedules: Schedule[] }>('/api/schedules');
  },

  updateSchedule(
    scheduleId: string,
    updates: { cronExpression?: string; environmentId?: string | null; enabled?: boolean },
  ) {
    return request<Schedule>(`/api/schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  deleteSchedule(scheduleId: string) {
    return request<void>(`/api/schedules/${scheduleId}`, { method: 'DELETE' });
  },

  triggerSchedule(scheduleId: string) {
    return request<{ runId: string; runIds: string[]; testSuiteVersionId: string }>(
      `/api/schedules/${scheduleId}/trigger-now`,
      { method: 'POST' },
    );
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

  listDatasetVersions(id: string) {
    return request<{
      versions: Array<{
        id: string;
        version: number;
        createdAt: string;
        rows: Record<string, unknown>[];
        sensitiveFields: string[];
      }>;
    }>(`/api/datasets/${id}/versions`);
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

export interface PlanSuggestion {
  agent?: AgentSnapshot | null;
  workerId?: string | null;
  attempt?: number;
  inputHash?: string;
  originalProposal?: unknown;
  events?: Array<{
    type: string;
    at: string;
    tool?: string;
    success: boolean;
    inputTokens?: number;
    outputTokens?: number;
  }>;
  id: string;
  status: string;
  trigger: string;
  parentId: string | null;
  objective: string;
  assets: PlanAsset[];
  proposal: PlanProposal | null;
  revision: number;
  savedAt: string | null;
  suiteId: string | null;
  errorCode: string | null;
  createdAt: string;
  sourceHash: string;
  model: { provider: string; model: string };
}
export const planClient = {
  list: () =>
    request<{ jobs: PlanSuggestion[]; settings: { enabled: boolean; agentId?: string | null } }>(
      '/api/plan-suggestions',
    ),
  settings: (enabled: boolean, agentId?: string) =>
    request<{ enabled: boolean }>('/api/plan-suggestions/settings', {
      method: 'PUT',
      body: JSON.stringify({ enabled, agentId }),
    }),
  generate: (objective: string, parentId?: string, revision?: number, agentId?: string) =>
    request<{ job: PlanSuggestion }>('/api/plan-suggestions', {
      method: 'POST',
      body: JSON.stringify({ objective, parentId, revision, agentId }),
    }),
  save: (id: string, revision: number, proposal: PlanProposal) =>
    request<{ job: PlanSuggestion }>(`/api/plan-suggestions/${encodeURIComponent(id)}/save`, {
      method: 'POST',
      body: JSON.stringify({ revision, proposal }),
    }),
  publish: (id: string, revision: number) =>
    request<{ suiteId: string }>(`/api/plan-suggestions/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ revision }),
    }),
  cancel: (id: string, revision: number) =>
    request(`/api/plan-suggestions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ revision }),
    }),
};
