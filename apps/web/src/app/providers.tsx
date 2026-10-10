import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { UNAUTHORIZED_EVENT } from '../lib/auth-session';
import { cpClient } from '../lib/cp-client';
import { useAuthStore } from '../stores/authStore';

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const [initialToken] = useState(token);
  const [ready, setReady] = useState(false);
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setHydrated = useAuthStore((state) => state.setHydrated);

  useEffect(() => {
    const handleUnauthorized = () => clearSession();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setHydrated(false);

    const session = (async () => {
      try {
        const guestSession = await cpClient.getGuestSession();
        if (guestSession.enabled) return guestSession;
      } catch (guestError) {
        if (!initialToken) throw guestError;
      }
      if (!initialToken) throw new Error('No product session is available');
      const { user } = await cpClient.getMe();
      return { token: initialToken, user };
    })();

    void session
      .then((nextSession) => {
        if (!cancelled) setSession(nextSession.token, nextSession.user);
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) {
          setHydrated(true);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession, initialToken, setHydrated, setSession]);

  if (!ready) {
    return (
      <main className="workspace-loading" aria-busy="true">
        正在准备工作区…
      </main>
    );
  }

  return children;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <AuthBootstrap>{children}</AuthBootstrap>
    </BrowserRouter>
  );
}
