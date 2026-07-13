import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AUTH_STORAGE_KEY } from '../../lib/auth-session';
import { cpClient } from '../../lib/cp-client';
import { useAuthStore } from '../../stores/authStore';
import { LoginPage } from '.';

vi.mock('../../lib/cp-client', () => ({
  cpClient: { login: vi.fn() },
}));

const login = vi.mocked(cpClient.login);
const user = {
  id: 'usr_owner',
  email: 'owner@example.test',
  displayName: 'Owner',
  role: 'owner' as const,
  workspaceId: 'ws_primary',
};

describe('LoginPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    login.mockReset();
    useAuthStore.setState({ token: null, user: null, hydrated: true });
  });

  test('authenticates against a specific workspace and persists the session', async () => {
    login.mockResolvedValue({ token: 'jwt-token', user });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/apis" element={<h1>接口资产</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Workspace ID'), {
      target: { value: 'ws_primary' },
    });
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'owner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await screen.findByRole('heading', { name: '接口资产' });
    expect(login).toHaveBeenCalledWith('owner@example.test', 'correct-password', 'ws_primary');
    expect(useAuthStore.getState()).toMatchObject({ token: 'jwt-token', user });
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? '{}')).toMatchObject({
        token: 'jwt-token',
        user,
      });
    });
  });
});
