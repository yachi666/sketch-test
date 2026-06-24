import { create } from 'zustand';
import { cpClient, type User } from '../lib/cp-client';

const AUTH_TOKEN_KEY = 'sketchtest.auth-token:v1';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;

  /** Login with email/password. Stores token in localStorage. */
  login: (email: string, password: string, workspaceId?: string) => Promise<void>;
  /** Logout — clear token and user. */
  logout: () => void;
  /** Restore session from stored token. */
  restoreSession: () => Promise<void>;
  /** Whether the user is authenticated. */
  isAuthenticated: () => boolean;
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Silently ignore
  }
}

function clearToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Silently ignore
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getStoredToken(),
  loading: false,
  error: null,

  login: async (email: string, password: string, workspaceId?: string) => {
    set({ loading: true, error: null });
    try {
      const { user, token } = await cpClient.login(email, password, workspaceId);
      storeToken(token);
      set({ user, token, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
      throw err;
    }
  },

  logout: () => {
    clearToken();
    set({ user: null, token: null });
  },

  restoreSession: async () => {
    const token = get().token;
    if (!token) return;

    set({ loading: true });
    try {
      const user = await cpClient.getMe(token);
      set({ user, loading: false });
    } catch {
      // Token expired or invalid
      clearToken();
      set({ user: null, token: null, loading: false });
    }
  },

  isAuthenticated: () => get().user !== null && get().token !== null,
}));
