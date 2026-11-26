// React-Anbindung des Spielablaufs: Store pro Tisch und tickende Uhr für den Timer-Ring.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppConnection } from './ConnectionProvider';
import type { GameConnection } from './connection';
import { TableGameStore, type TableGameSnapshot } from './tableGame';

/**
 * Store für einen Tisch über der Verbindung der App, solange die Komponente lebt; beim Verlassen wird
 * nur der Tisch freigegeben, die Verbindung bleibt. `connection` ersetzt sie in Tests.
 */
export function useTableGame(tableId: number, connection?: GameConnection): [TableGameSnapshot, TableGameStore] {
  const app = useAppConnection();
  // Ein Store pro Mount; für einen anderen Tisch neu mounten (`key={tableId}`).
  const [store] = useState(() => {
    const shared = connection ?? app?.connection;
    if (shared === undefined) throw new Error('useTableGame braucht einen <ConnectionProvider> und eine Anmeldung');
    return new TableGameStore(shared, tableId);
  });
  useEffect(() => {
    store.start();
    return () => {
      store.stop();
    };
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [snapshot, store];
}

/** Aktuelle Zeit, die alle `intervalMs` neu gerendert wird, solange `active`. */
export function useNow(active: boolean, intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [active, intervalMs]);
  return now;
}
