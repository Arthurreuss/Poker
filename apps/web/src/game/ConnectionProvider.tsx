// Eine WebSocket-Verbindung für die ganze App (ADR XXXX): solange jemand angemeldet ist, offen über alle
// Seitenwechsel; Lobby, Einladungsseite, Tisch und Zug-Hinweis nutzen sie gemeinsam. Abmelden oder ein
// anderes Konto beendet sie.
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { GameConnection } from './connection';
import { TurnWatcher } from './turnWatcher';

export interface AppConnection {
  readonly connection: GameConnection;
  readonly turns: TurnWatcher;
}

const ConnectionContext = createContext<AppConnection | null>(null);

export function ConnectionProvider({
  children,
  createConnection = () => new GameConnection(),
}: {
  children: ReactNode;
  /** Für Tests (gefälschter Socket); sonst eine echte Verbindung auf `/ws`. */
  createConnection?: (() => GameConnection) | undefined;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Die erste Fabrik gilt: neue Verbindung nur je Konto, nicht bei jedem Rendern des Aufrufers.
  const [create] = useState(() => createConnection);
  const value = useMemo<AppConnection | null>(() => {
    if (userId === null) return null;
    const connection = create();
    return { connection, turns: new TurnWatcher(connection) };
  }, [userId, create]);
  useEffect(() => {
    if (value === null) return undefined;
    value.turns.start();
    value.connection.start();
    return () => {
      value.turns.stop();
      value.connection.stop();
    };
  }, [value]);
  return <ConnectionContext value={value}>{children}</ConnectionContext>;
}

/** Die Verbindung der App, `null` ohne Anmeldung bzw. ohne `ConnectionProvider`. */
export function useAppConnection(): AppConnection | null {
  return use(ConnectionContext);
}

/** Die Verbindung der App für Seiten hinter dem Login. */
export function useConnection(): GameConnection {
  const value = use(ConnectionContext);
  if (value === null) throw new Error('useConnection braucht einen <ConnectionProvider> und eine Anmeldung');
  return value.connection;
}
