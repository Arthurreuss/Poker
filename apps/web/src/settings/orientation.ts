// Bevorzugte Ausrichtung der Tischansicht (D-009): Auto folgt dem Gerät, Hoch/Quer erzwingen ein Layout.
// Lokal gespeichert (localStorage); alle Komponenten, die den Hook nutzen, sehen Änderungen sofort.
import { useCallback, useSyncExternalStore } from 'react';

export type OrientationPreference = 'auto' | 'portrait' | 'landscape';

export const ORIENTATION_PREFERENCES: readonly OrientationPreference[] = ['auto', 'portrait', 'landscape'];
export const ORIENTATION_STORAGE_KEY = 'poker.orientation';
const DEFAULT_PREFERENCE: OrientationPreference = 'auto';

function isPreference(value: unknown): value is OrientationPreference {
  return typeof value === 'string' && (ORIENTATION_PREFERENCES as readonly string[]).includes(value);
}

// Fallback, falls localStorage fehlt oder wirft (privater Modus, blockierte Website-Daten).
let memoryValue: OrientationPreference = DEFAULT_PREFERENCE;
const listeners = new Set<() => void>();

export function readOrientationPreference(): OrientationPreference {
  try {
    const stored = window.localStorage.getItem(ORIENTATION_STORAGE_KEY);
    if (stored === null) return memoryValue;
    return isPreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    return memoryValue;
  }
}

export function writeOrientationPreference(value: OrientationPreference): void {
  memoryValue = value;
  try {
    window.localStorage.setItem(ORIENTATION_STORAGE_KEY, value);
  } catch {
    // Nur im Speicher behalten.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Änderungen aus anderen Tabs.
  const onStorage = (event: StorageEvent) => {
    if (event.key === ORIENTATION_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `[preference, setPreference]` – z. B. für Einstellungen und das Tisch-Menü (WP-017). */
export function useOrientationPreference(): [OrientationPreference, (value: OrientationPreference) => void] {
  const preference = useSyncExternalStore(subscribe, readOrientationPreference, () => DEFAULT_PREFERENCE);
  const setPreference = useCallback((value: OrientationPreference) => {
    writeOrientationPreference(value);
  }, []);
  return [preference, setPreference];
}

export const ORIENTATION_LABELS: Record<OrientationPreference, string> = {
  auto: 'Automatisch (Gerät)',
  portrait: 'Hochformat',
  landscape: 'Querformat',
};
