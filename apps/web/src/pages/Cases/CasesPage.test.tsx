import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import { CasesPage } from '.';

const { getGenerationJob, listDrafts, listTestCases } = vi.hoisted(() => ({
  getGenerationJob: vi.fn(),
  listDrafts: vi.fn(),
  listTestCases: vi.fn(),
}));

vi.mock('../../lib/cp-client', () => ({
  cpClient: {
    acceptDraft: vi.fn(),
    getGenerationJob,
    listDrafts,
    listTestCases,
    rejectDraft: vi.fn(),
  },
}));

describe('CasesPage generation review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      token: 'test-token',
      hydrated: true,
      user: {
        id: 'usr-owner',
        email: 'owner@example.test',
        displayName: 'Owner',
        role: 'owner',
        workspaceId: 'ws-primary',
      },
    });
    listTestCases.mockResolvedValue({ testCases: [] });
    getGenerationJob
      .mockResolvedValueOnce({ id: 'gj-test', status: 'pending' })
      .mockResolvedValue({ id: 'gj-test', status: 'completed' });
    listDrafts.mockResolvedValue({
      drafts: [
        {
          id: 'draft-1',
          jobId: 'gj-test',
          definitionSummary: { name: 'Happy path: POST /orders', sideEffect: 'cleanup-required' },
          sourceInfo: { method: 'POST', path: '/orders' },
          confidence: 0.8,
          status: 'pending',
        },
      ],
    });
  });

  test('polls an asynchronous generation job and displays its summary-only drafts', async () => {
    render(
      <MemoryRouter initialEntries={['/cases?generationJobId=gj-test']}>
        <CasesPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(getGenerationJob).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(await screen.findByText('Happy path: POST /orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看并审阅' })).toBeInTheDocument();
  });
});
