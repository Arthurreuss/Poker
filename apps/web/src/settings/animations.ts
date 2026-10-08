// Animationen am Tisch an/aus (WP-018). Lokal gespeichert (localStorage), Standard: an.
// Unabhängig davon schaltet `prefers-reduced-motion: reduce` die Animationen per CSS ab.
import { useCallback, useSyncExternalStore } from 'react';

export const ANIMATIONS_STORAGE_KEY = 'poker.animations';
const DEFAULT_VALUE = true;

let memoryValue = DEFAULT_VALUE;
const listeners = new Set<() => void>();

export function readAnimationsPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(ANIMATIONS_STORAGE_KEY);
    if (stored === null) return memoryValue;
    return stored !== 'off';
  } catch {
    return memoryValue;
  }
}

export function writeAnimationsPreference(value: boolean): void {
  memoryValue = value;
  try {
    window.localStorage.setItem(ANIMATIONS_STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Nur im Speicher behalten.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ANIMATIONS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `[enabled, setEnabled]` – Einstellungsseite und Tisch. */
export function useAnimationsPreference(): [boolean, (value: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readAnimationsPreference, () => DEFAULT_VALUE);
  const setEnabled = useCallback((value: boolean) => {
    writeAnimationsPreference(value);
  }, []);
  return [enabled, setEnabled];
}
