// Ton und Vibration am Tisch (WP-031). Pro Gerät in localStorage (Zugriffe in try/catch, sonst nur im
// Speicher); Standard: Ton an, Lautstärke 70 %, Vibration an (nur wo `navigator.vibrate` existiert).
import { useCallback, useSyncExternalStore } from 'react';

export const SOUND_STORAGE_KEY = 'poker.sound';

export interface SoundPreference {
  readonly enabled: boolean;
  /** 0–1 */
  readonly volume: number;
  /** „Du bist dran“ zusätzlich per Vibration (wo verfügbar). */
  readonly vibrate: boolean;
}

export const DEFAULT_SOUND: SoundPreference = { enabled: true, volume: 0.7, vibrate: true };

let memoryValue: SoundPreference = DEFAULT_SOUND;
let cache: { raw: string | null; value: SoundPreference } | null = null;
const listeners = new Set<() => void>();

function clamp01(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

/** Gespeicherten Wert lesen und prüfen; Unbekanntes fällt auf den Standard zurück. */
export function parseSoundPreference(raw: string | null): SoundPreference {
  if (raw === null) return DEFAULT_SOUND;
  try {
    const data = JSON.parse(raw) as Partial<Record<keyof SoundPreference, unknown>>;
    return {
      enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_SOUND.enabled,
      volume: clamp01(data.volume, DEFAULT_SOUND.volume),
      vibrate: typeof data.vibrate === 'boolean' ? data.vibrate : DEFAULT_SOUND.vibrate,
    };
  } catch {
    return DEFAULT_SOUND;
  }
}

export function readSoundPreference(): SoundPreference {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SOUND_STORAGE_KEY);
  } catch {
    return memoryValue;
  }
  if (raw === null) return memoryValue;
  if (cache?.raw !== raw) cache = { raw, value: parseSoundPreference(raw) };
  return cache.value;
}

export function writeSoundPreference(patch: Partial<SoundPreference>): void {
  const value: SoundPreference = { ...readSoundPreference(), ...patch };
  memoryValue = { ...value, volume: clamp01(value.volume, DEFAULT_SOUND.volume) };
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(memoryValue));
  } catch {
    // Nur im Speicher behalten.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** `[preference, update]` – Einstellungsseite und Tisch. */
export function useSoundPreference(): [SoundPreference, (patch: Partial<SoundPreference>) => void] {
  const value = useSyncExternalStore(subscribe, readSoundPreference, () => DEFAULT_SOUND);
  const update = useCallback((patch: Partial<SoundPreference>) => {
    writeSoundPreference(patch);
  }, []);
  return [value, update];
}

/** Kann das Gerät vibrieren? (iOS Safari: nein) */
export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
