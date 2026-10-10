import type { User } from './cp-client';

export const AUTH_STORAGE_KEY = 'sketchtest.auth.v1';
export const UNAUTHORIZED_EVENT = 'sketchtest:unauthorized';

export interface AuthSession {
  token: string;
  user: User;
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (typeof parsed.token !== 'string' || !parsed.user?.workspaceId) return null;
    return parsed as AuthSession;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function writeAuthSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function storedAccessToken(): string | null {
  return readAuthSession()?.token ?? null;
}

export function notifyUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
