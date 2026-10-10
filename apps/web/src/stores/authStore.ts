import { create } from 'zustand';
import {
  type AuthSession,
  clearAuthSession,
  readAuthSession,
  writeAuthSession,
} from '../lib/auth-session';
import { cpClient, type User } from '../lib/cp-client';

interface AuthState {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
  setHydrated: (hydrated: boolean) => void;
  logout: () => void;
  restoreSession: () => Promise<void>;
  isAuthenticated: () => boolean;
}

const stored: AuthSession | null = readAuthSession();

const LEGACY_TOKEN_KEY = 'sketchtest.auth-token:v1';

function clearLegacyToken() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LEGACY_TOKEN_KEY);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: stored?.token ?? null,
  user: stored?.user ?? null,
  hydrated: true,
  loading: false,
  error: null,
  setSession: (token, user) => {
    writeAuthSession({ token, user });
    set({ token, user, hydrated: true, loading: false, error: null });
  },
  clearSession: () => {
    clearAuthSession();
    clearLegacyToken();
    set({ token: null, user: null, hydrated: true, loading: false });
  },
  setHydrated: (hydrated) => set({ hydrated }),
  logout: () => get().clearSession(),
  restoreSession: async () => {
    const token = get().token;
    if (!token) return;
    set({ loading: true, error: null, hydrated: false });
    try {
      const result = await cpClient.getMe(token);
      const user = 'user' in result ? result.user : (result as unknown as User);
      writeAuthSession({ token, user });
      set({ user, loading: false, hydrated: true });
    } catch {
      get().clearSession();
    }
  },
  isAuthenticated: () => get().user !== null && get().token !== null,
}));
