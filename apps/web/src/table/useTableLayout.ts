// Welches Layout die Tischansicht zeigt (D-009, WP-017): Präferenz aus den Einstellungen plus
// tatsächliche Ausrichtung des Viewports (Media-Query), live aktualisiert.
import { useSyncExternalStore } from 'react';
import type { OrientationPreference } from '../settings/orientation';
import { resolveLayout, type TableLayout } from './layout';

export const LANDSCAPE_QUERY = '(orientation: landscape)';

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(LANDSCAPE_QUERY)
    : null;
}

function subscribe(listener: () => void): () => void {
  const mql = mediaQuery();
  if (mql === null) return () => undefined;
  mql.addEventListener('change', listener);
  return () => {
    mql.removeEventListener('change', listener);
  };
}

function isDeviceLandscape(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** `true`, wenn der Viewport gerade im Querformat ist (breiter als hoch). */
export function useDeviceLandscape(): boolean {
  return useSyncExternalStore(subscribe, isDeviceLandscape, () => false);
}

/** Layout der Tischansicht für eine Präferenz: `auto` folgt dem Viewport, sonst erzwungen. */
export function useTableLayout(preference: OrientationPreference): TableLayout {
  return resolveLayout(preference, useDeviceLandscape());
}
