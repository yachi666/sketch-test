import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const { getGuestSessionMock, getMeMock } = vi.hoisted(() => ({
  getGuestSessionMock: vi.fn(),
  getMeMock: vi.fn(),
}));

vi.mock('../lib/cp-client', () => ({
  cpClient: {
    getGuestSession: (...args: unknown[]) => getGuestSessionMock(...args),
    getMe: (...args: unknown[]) => getMeMock(...args),
  },
}));

import { useAuthStore } from '../stores/authStore';
import { Providers } from './providers';

const guestUser = {
  id: 'usr_guest',
  email: 'guest@example.test',
  displayName: 'Guest',
  role: 'owner' as const,
  workspaceId: 'ws_guest',
};

beforeEach(() => {
  window.localStorage.clear();
  getGuestSessionMock.mockReset();
  getMeMock.mockReset();
  useAuthStore.setState({ token: null, user: null, hydrated: true });
});

test('provisions a guest session before rendering the product', async () => {
  getGuestSessionMock.mockResolvedValue({ enabled: true, token: 'guest-token', user: guestUser });
  useAuthStore.setState({
    token: 'stale-token',
    user: { ...guestUser, id: 'usr_stale', workspaceId: 'ws_stale' },
  });

  render(
    <Providers>
      <div>产品工作台</div>
    </Providers>,
  );

  expect(screen.getByText('正在准备工作区…')).toBeInTheDocument();
  expect(await screen.findByText('产品工作台')).toBeInTheDocument();
  expect(getGuestSessionMock).toHaveBeenCalledTimes(1);
  expect(getMeMock).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(useAuthStore.getState()).toMatchObject({ token: 'guest-token', user: guestUser });
  });
});
