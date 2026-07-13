import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { UNAUTHORIZED_EVENT } from '../lib/auth-session';
import { cpClient } from '../lib/cp-client';
import { useAuthStore } from '../stores/authStore';

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const setSession = useAuthStore((state) => state.setSession);
  const clearSession = useAuthStore((state) => state.clearSession);
  const setHydrated = useAuthStore((state) => state.setHydrated);

  useEffect(() => {
    const handleUnauthorized = () => clearSession();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  useEffect(() => {
    if (!token) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    setHydrated(false);
    void cpClient
      .getMe()
      .then(({ user }) => {
        if (!cancelled) setSession(token, user);
      })
      .catch(() => {
        if (!cancelled) clearSession();
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession, setHydrated, setSession, token]);

  return children;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <AuthBootstrap>{children}</AuthBootstrap>
    </BrowserRouter>
  );
}
