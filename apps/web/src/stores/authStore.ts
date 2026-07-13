import { create } from 'zustand';
import {
  type AuthSession,
  clearAuthSession,
  readAuthSession,
  writeAuthSession,
} from '../lib/auth-session';
import type { User } from '../lib/cp-client';

interface AuthState {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  setSession: (token: string, user: User) => void;
  clearSession: () => void;
  setHydrated: (hydrated: boolean) => void;
}

const stored: AuthSession | null = readAuthSession();

export const useAuthStore = create<AuthState>((set) => ({
  token: stored?.token ?? null,
  user: stored?.user ?? null,
  hydrated: !stored,
  setSession: (token, user) => {
    writeAuthSession({ token, user });
    set({ token, user });
  },
  clearSession: () => {
    clearAuthSession();
    set({ token: null, user: null, hydrated: true });
  },
  setHydrated: (hydrated) => set({ hydrated }),
}));
