// React-Anbindung des Spielablaufs (WP-018): Store pro Tisch und tickende Uhr für den Timer-Ring.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { GameConnection } from './connection';
import { TableGameStore, type TableGameSnapshot } from './tableGame';

/**
 * Verbindung + Store für einen Tisch, solange die Komponente lebt. `createConnection` ist für Tests;
 * ohne Angabe eine echte Verbindung auf `/ws`.
 */
export function useTableGame(
  tableId: number,
  createConnection: () => GameConnection = () => new GameConnection(),
): [TableGameSnapshot, TableGameStore] {
  // Ein Store pro Mount; für einen anderen Tisch neu mounten (`key={tableId}`).
  const [store] = useState(() => new TableGameStore(createConnection(), tableId));
  useEffect(() => {
    store.start();
    return () => {
      store.stop();
      store.connection.stop();
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
