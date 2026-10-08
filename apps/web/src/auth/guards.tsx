// Routen-Wächter: nur eingeloggt bzw. nur Admins.
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Zustand, den die Login-Seite für „danach zurück zur Zielseite“ auswertet. */
export interface RedirectState {
  from: string;
}

/** Liest das Ziel aus `location.state`; nur interne Pfade, sonst `/`. */
export function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null) {
    const { from } = state as Record<string, unknown>;
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from;
  }
  return '/';
}

export function LoadingScreen() {
  return (
    <p role="status" style={{ margin: 'auto', color: 'var(--color-text-muted)' }}>
      Laden …
    </p>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'anonymous') {
    if (state.loggedOut === true) return <Navigate to="/login" replace />;
    const redirect: RedirectState = { from: location.pathname + location.search + location.hash };
    return <Navigate to="/login" replace state={redirect} />;
  }
  return children;
}

/** Nur innerhalb von `RequireAuth` verwenden. Nicht-Admins landen in der Lobby. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.isAdmin !== true) return <Navigate to="/" replace />;
  return children;
}

/** Für /login und /register: wer schon eingeloggt ist, geht direkt zur Zielseite. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <LoadingScreen />;
  if (state.status === 'authenticated') return <Navigate to={redirectTarget(location.state)} replace />;
  return children;
}
