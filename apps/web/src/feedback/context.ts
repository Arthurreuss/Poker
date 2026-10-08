// Kontext, der automatisch mit jedem Feedback mitgeht (WP-024): Seite, Tisch-ID, App-Version, Ausrichtung.
// Den User-Agent liest der Server aus dem Request-Header.
import type { NewFeedback } from '../api/feedback';
import type { OrientationPreference } from '../settings/orientation';

/** Optionaler Kontext des Aufrufers (z. B. Tisch-Menü: echte Tisch-ID). */
export interface FeedbackContextOptions {
  /** Standard: aktueller Pfad (`window.location.pathname`). */
  page?: string;
  /** Standard: aus dem Pfad `/table/<zahl>`, sonst keiner. */
  tableId?: number | null;
}

export const PAGE_MAX_LENGTH = 200;

/** Build-Version (Commit), siehe vite.config.ts. */
export function appVersion(): string {
  return __APP_VERSION__;
}

/** Tisch-ID aus einem Pfad wie `/table/42`; sonst `null`. */
export function tableIdFromPath(path: string): number | null {
  const match = /^\/table\/(\d{1,9})(?:\/|$)/.exec(path);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function buildFeedbackContext(
  options: FeedbackContextOptions,
  orientation: OrientationPreference,
): Omit<NewFeedback, 'category' | 'message'> {
  const page = (options.page ?? window.location.pathname).slice(0, PAGE_MAX_LENGTH);
  return {
    page: page.startsWith('/') ? page : null,
    tableId: options.tableId === undefined ? tableIdFromPath(page) : options.tableId,
    appVersion: appVersion(),
    orientation,
  };
}
