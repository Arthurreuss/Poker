// Prüfung der Feedback-Eingaben ohne I/O (WP-024). Grenzen wie in migrations/0004_feedback.sql.

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const;
export const FEEDBACK_ORIENTATIONS = ['auto', 'portrait', 'landscape'] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackOrientation = (typeof FEEDBACK_ORIENTATIONS)[number];

/** Höchstlänge des Textes in Zeichen (Unicode-Codepoints wie `char_length` in Postgres). */
export const FEEDBACK_MAX_LENGTH = 2000;
export const FEEDBACK_PAGE_MAX_LENGTH = 200;
export const FEEDBACK_APP_VERSION_MAX_LENGTH = 100;
export const FEEDBACK_USER_AGENT_MAX_LENGTH = 500;

/** Eingabe von `POST /api/feedback` nach der Prüfung. */
export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  page: string | null;
  tableId: number | null;
  appVersion: string | null;
  orientation: FeedbackOrientation | null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return isOneOf(FEEDBACK_STATUSES, value);
}

/** Länge in Unicode-Codepoints (Emoji zählen als ein Zeichen, wie in Postgres). */
export function charLength(text: string): number {
  return Array.from(text).length;
}

/** Optionaler Text: fehlt/`null` → `null`; leer nach Trim → `null`; zu lang oder kein String → Fehler. */
function optionalText(value: unknown, max: number, name: string): Validation<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return fail(`${name} muss Text sein`);
  const trimmed = value.trim();
  if (charLength(trimmed) > max) return fail(`${name} ist zu lang (max. ${String(max)} Zeichen)`);
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

export function validateFeedback(body: unknown): Validation<FeedbackInput> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail('Ungültige Anfrage');
  const b = body as Record<string, unknown>;

  if (!isOneOf(FEEDBACK_CATEGORIES, b['category'])) return fail('Bitte eine Kategorie wählen (Bug, Idee, Sonstiges)');
  if (typeof b['message'] !== 'string') return fail('Bitte einen Text eingeben');
  const message = b['message'].trim();
  if (message === '') return fail('Bitte einen Text eingeben');
  if (charLength(message) > FEEDBACK_MAX_LENGTH) {
    return fail(`Der Text ist zu lang (max. ${String(FEEDBACK_MAX_LENGTH)} Zeichen)`);
  }

  const page = optionalText(b['page'], FEEDBACK_PAGE_MAX_LENGTH, 'Seite');
  if (!page.ok) return page;
  if (page.value !== null && !page.value.startsWith('/')) return fail('Seite muss ein Pfad sein');
  const appVersion = optionalText(b['appVersion'], FEEDBACK_APP_VERSION_MAX_LENGTH, 'App-Version');
  if (!appVersion.ok) return appVersion;

  const tableId = b['tableId'] ?? null;
  if (
    tableId !== null &&
    (!Number.isInteger(tableId) || (tableId as number) < 1 || (tableId as number) > 2 ** 31 - 1)
  ) {
    return fail('Tisch-ID ist ungültig');
  }
  const orientation = b['orientation'] ?? null;
  if (orientation !== null && !isOneOf(FEEDBACK_ORIENTATIONS, orientation)) return fail('Ausrichtung ist ungültig');

  return {
    ok: true,
    value: {
      category: b['category'],
      message,
      page: page.value,
      tableId: tableId as number | null,
      appVersion: appVersion.value,
      orientation,
    },
  };
}

/** User-Agent aus dem Header: gekürzt auf die Spaltenlänge, leer → `null`. */
export function normalizeUserAgent(header: string | string[] | undefined): string | null {
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  if (value === '') return null;
  return Array.from(value).slice(0, FEEDBACK_USER_AGENT_MAX_LENGTH).join('');
}
