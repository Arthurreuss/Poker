// Auth-Zustand der App: beim Start einmal GET /api/me, danach durch Login/Register/Logout gesetzt.
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AvatarId } from '@poker/engine/protocol';
import * as api from '../api';
import { ApiError, type Credentials, type User } from '../api';

export type AuthState =
  | { status: 'loading' }
  /**
   * `loggedOut`: bewusst abgemeldet – dann kein „zurück zur Zielseite“ nach dem nächsten Login.
   * `accountDeleted`: das Konto wurde eben gelöscht (WP-022) – die Login-Seite zeigt eine Bestätigung.
   */
  | { status: 'anonymous'; loggedOut?: boolean; accountDeleted?: boolean }
  | { status: 'authenticated'; user: User };

export interface AuthContextValue {
  state: AuthState;
  /** Eingeloggter User oder `null` (auch während des Ladens). */
  user: User | null;
  login: (credentials: Credentials) => Promise<User>;
  register: (credentials: Credentials) => Promise<User>;
  logout: () => Promise<void>;
  /** Konto löschen (WP-022); danach ausgeloggt. Wirft `ApiError` z. B. bei falschem Passwort (403). */
  deleteAccount: (password: string) => Promise<void>;
  /** Eigenen Avatar setzen (WP-032); wirft `ApiError`. Der User im Kontext wird danach aktualisiert. */
  setAvatar: (avatar: AvatarId | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    api.me(controller.signal).then(
      (user) => {
        setState({ status: 'authenticated', user });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        // 401 = nicht eingeloggt. Andere Fehler (Server weg) ebenfalls als ausgeloggt behandeln:
        // die Login-Seite zeigt dann beim nächsten Versuch die Fehlermeldung.
        if (!(err instanceof ApiError && err.status === 401)) console.warn('GET /api/me fehlgeschlagen', err);
        setState({ status: 'anonymous' });
      },
    );
    return () => {
      controller.abort();
    };
  }, []);

  const login = useCallback(async (credentials: Credentials) => {
    const user = await api.login(credentials);
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const register = useCallback(async (credentials: Credentials) => {
    const user = await api.register(credentials);
    setState({ status: 'authenticated', user });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Auch wenn der Server nicht antwortet: lokal ausloggen.
      setState({ status: 'anonymous', loggedOut: true });
    }
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password);
    setState({ status: 'anonymous', loggedOut: true, accountDeleted: true });
  }, []);

  const setAvatar = useCallback(async (avatar: AvatarId | null) => {
    const user = await api.updateAvatar(avatar);
    setState((previous) => (previous.status === 'authenticated' ? { status: 'authenticated', user } : previous));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      login,
      register,
      logout,
      deleteAccount,
      setAvatar,
    }),
    [state, login, register, logout, deleteAccount, setAvatar],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (value === null) throw new Error('useAuth braucht einen <AuthProvider>');
  return value;
}
