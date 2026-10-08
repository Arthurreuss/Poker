// Feedback ohne DB: Validierung, User-Agent, Konfiguration, CLI-Argumente und -Ausgabe (WP-024).
import { describe, expect, it } from 'vitest';
import { formatFeedbackItem, formatFeedbackList, parseFeedbackCliArgs } from './cli';
import { loadFeedbackConfig } from './config';
import type { FeedbackItem } from './store';
import { normalizeUserAgent, validateFeedback } from './validation';

describe('validateFeedback', () => {
  it('trimmt und übernimmt gültige Eingaben', () => {
    expect(
      validateFeedback({
        category: 'bug',
        message: '  hallo  ',
        page: '/table/3',
        tableId: 3,
        appVersion: ' abc ',
        orientation: 'landscape',
      }),
    ).toEqual({
      ok: true,
      value: {
        category: 'bug',
        message: 'hallo',
        page: '/table/3',
        tableId: 3,
        appVersion: 'abc',
        orientation: 'landscape',
      },
    });
  });

  it('leere optionale Felder werden null', () => {
    expect(validateFeedback({ category: 'other', message: 'x', page: '', appVersion: null, tableId: null })).toEqual({
      ok: true,
      value: { category: 'other', message: 'x', page: null, tableId: null, appVersion: null, orientation: null },
    });
  });

  it('zählt Unicode-Zeichen statt UTF-16-Einheiten', () => {
    expect(validateFeedback({ category: 'idea', message: '😀'.repeat(2000) }).ok).toBe(true);
    expect(validateFeedback({ category: 'idea', message: '😀'.repeat(2001) }).ok).toBe(false);
  });

  it.each([
    [null],
    ['text'],
    [{ category: 'idee', message: 'x' }],
    [{ category: 'bug', message: '' }],
    [{ category: 'bug', message: 'x', tableId: 0 }],
    [{ category: 'bug', message: 'x', tableId: 1.5 }],
    [{ category: 'bug', message: 'x', page: 5 }],
    [{ category: 'bug', message: 'x', page: `/${'a'.repeat(200)}` }],
  ])('lehnt %j ab', (body) => {
    expect(validateFeedback(body).ok).toBe(false);
  });
});

describe('normalizeUserAgent', () => {
  it('kürzt auf 500 Zeichen, leer → null', () => {
    expect(normalizeUserAgent(undefined)).toBeNull();
    expect(normalizeUserAgent('  ')).toBeNull();
    expect(normalizeUserAgent(['a', 'b'])).toBe('a');
    expect(normalizeUserAgent('x'.repeat(600))).toHaveLength(500);
  });
});

describe('loadFeedbackConfig', () => {
  it('Standard 5 pro Stunde, 0 schaltet ab, Unsinn wirft', () => {
    expect(loadFeedbackConfig({})).toEqual({ rateLimit: { max: 5, windowMs: 3_600_000 } });
    expect(loadFeedbackConfig({ FEEDBACK_RATE_LIMIT_MAX: '0' })).toEqual({ rateLimit: null });
    expect(loadFeedbackConfig({ FEEDBACK_RATE_LIMIT_MAX: '2', FEEDBACK_RATE_LIMIT_WINDOW_SECONDS: '60' })).toEqual({
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    expect(() => loadFeedbackConfig({ FEEDBACK_RATE_LIMIT_MAX: '-1' })).toThrow(/FEEDBACK_RATE_LIMIT_MAX/);
    expect(() => loadFeedbackConfig({ FEEDBACK_RATE_LIMIT_WINDOW_SECONDS: '0' })).toThrow();
  });
});

describe('CLI admin:feedback', () => {
  it('liest Argumente', () => {
    expect(parseFeedbackCliArgs([])).toEqual({ status: null, limit: 20 });
    expect(parseFeedbackCliArgs(['--status', 'new', '--limit', '5'])).toEqual({ status: 'new', limit: 5 });
    expect(parseFeedbackCliArgs(['--status=done'])).toEqual({ status: 'done', limit: 20 });
    expect(parseFeedbackCliArgs(['--status', 'all'])).toEqual({ status: null, limit: 20 });
    expect(parseFeedbackCliArgs(['--status', 'neu'])).toBeNull();
    expect(parseFeedbackCliArgs(['--limit', '0'])).toBeNull();
    expect(parseFeedbackCliArgs(['--limit'])).toBeNull();
    expect(parseFeedbackCliArgs(['alice'])).toBeNull();
  });

  const item: FeedbackItem = {
    id: 12,
    userId: null,
    username: null,
    category: 'idea',
    message: 'Zeile 1\nZeile 2',
    page: '/',
    tableId: null,
    appVersion: null,
    userAgent: null,
    orientation: null,
    status: 'done',
    createdAt: new Date(2026, 9, 8, 14, 3).toISOString(),
  };

  it('formatiert Einträge, auch anonymisierte', () => {
    expect(formatFeedbackItem(item)).toBe(
      '#12  2026-10-08 14:03  [erledigt]  Idee  von gelöschter Account\n    Zeile 1\n    Zeile 2\n    – Seite /',
    );
    expect(formatFeedbackList([], null)).toBe('Kein Feedback vorhanden.');
    expect(formatFeedbackList([], 'new')).toBe('Kein Feedback mit Status „neu“.');
  });
});
