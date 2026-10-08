// Emoji-Reaktionen am Tisch für sich selbst ein/aus (WP-032). Lokal gespeichert (localStorage), Standard: an.
// Aus = keine Reaktionen einblenden und keinen Reaktions-Knopf zeigen; der Server schickt sie trotzdem.
import { useCallback, useSyncExternalStore } from 'react';

export const REACTIONS_STORAGE_KEY = 'poker.reactions';
const DEFAULT_VALUE = true;

let memoryValue = DEFAULT_VALUE;
const listeners = new Set<() => void>();

export function readReactionsPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(REACTIONS_STORAGE_KEY);
    if (stored === null) return memoryValue;
    return stored !== 'off';
  } catch {
    return memoryValue;
  }
}

export function writeReactionsPreference(value: boolean): void {
  memoryValue = value;
  try {
    window.localStorage.setItem(REACTIONS_STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Nur im Speicher behalten.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === REACTIONS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `[enabled, setEnabled]` – Einstellungsseite und Tisch (WP-032). */
export function useReactionsPreference(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readReactionsPreference, () => DEFAULT_VALUE);
  const setEnabled = useCallback((value: boolean) => {
    writeReactionsPreference(value);
  }, []);
  return [enabled, setEnabled];
}
