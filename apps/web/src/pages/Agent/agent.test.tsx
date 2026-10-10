import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { AgentPage } from './index';

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    aiCapabilities: vi.fn(),
    analyzeRepository: vi.fn(),
    listApiVersions: vi.fn(),
    getApiVersion: vi.fn(),
    listGenerationJobs: vi.fn(),
    startGeneration: vi.fn(),
    changeGeneration: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: {
      id: 'u',
      workspaceId: 'ws',
      email: 'test@example.test',
      displayName: 'Tester',
      role: 'owner',
    },
  });
  vi.mocked(cpClient.aiCapabilities).mockResolvedValue({
    configured: true,
    available: true,
    workers: [
      { workerId: 'w', provider: 'deepseek', model: 'deepseek-v4-flash', harnessVersion: '0.85.1' },
    ],
  });
  vi.mocked(cpClient.listApiVersions).mockResolvedValue({
    apiVersions: [
      {
        id: 'av',
        sourceType: 'url',
        sourceLocation: 'Health',
        contentHash: 'a'.repeat(64),
        createdAt: '2026-09-12T00:00:00Z',
        endpointCount: 1,
        diagnosticCount: 0,
      },
    ],
  });
  vi.mocked(cpClient.getApiVersion).mockResolvedValue({
    id: 'av',
    sourceType: 'url',
    sourceLocation: 'Health',
    contentHash: 'a'.repeat(64),
    createdAt: '2026-09-12T00:00:00Z',
    endpoints: [{ id: 'health', method: 'GET', path: '/health' }],
    schemas: {},
    diagnostics: [],
    servers: [],
  });
  vi.mocked(cpClient.listGenerationJobs).mockResolvedValue({ jobs: [] });
});
test('queues user intent against the selected immutable API version', async () => {
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );
  const button = await screen.findByRole('button', { name: /生成待审草稿/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByLabelText('测试目标'), { target: { value: 'Verify health' } });
  fireEvent.click(button);
  await waitFor(() =>
    expect(cpClient.startGeneration).toHaveBeenCalledWith(
      'ws',
      'av',
      'pi',
      ['health'],
      'Verify health',
    ),
  );
});
test('offline worker is not presented as ready', async () => {
  vi.mocked(cpClient.aiCapabilities).mockResolvedValue({
    configured: true,
    available: false,
    workers: [],
  });
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: '等待 Worker 上线' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /生成待审草稿/ })).toBeDisabled();
});

test('restores GitHub input, analyzes the real backend result and invalidates selection when source changes', async () => {
  vi.mocked(cpClient.analyzeRepository).mockResolvedValue({
    apiVersionId: 'code_av',
    repositoryUrl: 'https://github.com/team/server',
    commit: 'a'.repeat(40),
    scannedFiles: 3,
    endpointCount: 1,
    diagnostics: [],
  });
  vi.mocked(cpClient.getApiVersion).mockImplementation(async (id) => ({
    id,
    sourceType: 'code-discovery',
    sourceLocation: 'https://github.com/team/server',
    contentHash: 'a'.repeat(64),
    createdAt: '2026-09-23T00:00:00Z',
    endpoints: [
      {
        id: 'code_health',
        method: 'GET',
        path: '/health',
        responses: [{ statusCode: 200 }],
        sourceLocations: [
          {
            sourceLabel: 'HealthController.java',
            location: `https://github.com/team/server/blob/${'a'.repeat(40)}/HealthController.java#L4`,
          },
        ],
      },
    ],
    schemas: {},
    diagnostics: [],
    servers: [],
    metadata: {
      extra: {
        repositoryUrl: 'https://github.com/team/server',
        commit: 'a'.repeat(40),
        files: [{}],
      },
    },
  }));
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 仓库' }));
  const generate = screen.getByRole('button', { name: /生成待审草稿/ });
  expect(generate).toBeDisabled();
  fireEvent.change(screen.getByLabelText('GitHub 仓库 URL'), {
    target: { value: 'https://github.com/team/server' },
  });
  fireEvent.click(screen.getByRole('button', { name: '分析仓库接口' }));
  await waitFor(() =>
    expect(cpClient.analyzeRepository).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/team/server',
      ref: undefined,
      directory: undefined,
    }),
  );
  await waitFor(() => expect(generate).toBeEnabled());
  expect(screen.getByRole('link', { name: '查看 GET /health 的源码' })).toHaveAttribute(
    'href',
    expect.stringContaining('/blob/'),
  );
  fireEvent.click(generate);
  await waitFor(() =>
    expect(cpClient.startGeneration).toHaveBeenCalledWith(
      'ws',
      'code_av',
      'pi',
      ['code_health'],
      expect.any(String),
    ),
  );
  fireEvent.change(screen.getByLabelText('GitHub 仓库 URL'), {
    target: { value: 'https://github.com/team/another' },
  });
  expect(generate).toBeDisabled();
});

test('GitHub analysis failure stays actionable and never enables generation from a stale API', async () => {
  vi.mocked(cpClient.analyzeRepository).mockRejectedValue(
    new Error('GitHub 请求限流，请稍后再试。'),
  );
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'GitHub 仓库' }));
  fireEvent.change(screen.getByLabelText('GitHub 仓库 URL'), {
    target: { value: 'https://github.com/team/server' },
  });
  fireEvent.click(screen.getByRole('button', { name: '分析仓库接口' }));
  expect(await screen.findByText('GitHub 请求限流，请稍后再试。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /生成待审草稿/ })).toBeDisabled();
});

test('shows actual coverage when a model completes with fewer drafts than selected endpoints', async () => {
  vi.mocked(cpClient.listGenerationJobs).mockResolvedValue({
    jobs: [
      {
        id: 'gj_partial',
        apiVersionId: 'av',
        strategy: 'pi',
        status: 'completed',
        createdAt: '2026-09-23T00:00:00Z',
        completedAt: '2026-09-23T00:01:00Z',
        config: { objective: '员工回归', endpointIds: ['one', 'two', 'three'] },
        draftCount: 1,
        coveredEndpointCount: 1,
      },
    ],
  });
  render(
    <MemoryRouter>
      <AgentPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText(/产出 1 条草稿 · 覆盖 1 \/ 3 个所选接口/)).toBeInTheDocument();
});
