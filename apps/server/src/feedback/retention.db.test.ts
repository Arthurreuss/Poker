// Speicherdauer von Feedback (WP-022, D-025) gegen die Test-DB (nur mit TEST_DATABASE_URL, sonst übersprungen).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { FeedbackRow } from '../db/types';
import { FEEDBACK_RETENTION, purgeExpiredFeedback, startFeedbackPurgeJob } from './retention';
import { updateFeedbackStatus } from './store';

const DAY = 86_400_000;
const NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe.skipIf(testDatabaseUrl === undefined)('Feedback-Speicherdauer (Test-DB)', () => {
  let s: TestSchema;

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query('TRUNCATE feedback RESTART IDENTITY');
  });

  /** Legt ein Feedback ohne User an (wie nach Account-Löschung) und liefert die ID. */
  async function insert(message: string, createdAt: Date, doneAt: Date | null = null): Promise<number> {
    const { rows } = await s.pool.query<{ id: number }>(
      `INSERT INTO feedback (category, message, status, created_at, done_at)
       VALUES ('bug', $1, $2, $3, $4) RETURNING id`,
      [message, doneAt === null ? 'new' : 'done', createdAt, doneAt],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('kein Insert');
    return row.id;
  }

  async function messages(): Promise<string[]> {
    return (await s.pool.query<{ message: string }>('SELECT message FROM feedback ORDER BY id')).rows.map(
      (r) => r.message,
    );
  }

  it('Fristen laut Datenschutzerklärung: 30 Tage nach Erledigen, spätestens 1 Jahr', () => {
    expect(FEEDBACK_RETENTION).toEqual({ doneDays: 30, maxDays: 365 });
  });

  it('löscht erledigtes nach 30 Tagen und alles nach 1 Jahr, sonst nichts', async () => {
    await insert('neu, frisch', daysAgo(1));
    await insert('neu, 364 Tage alt', daysAgo(364));
    await insert('neu, genau 1 Jahr alt', daysAgo(365));
    await insert('neu, älter als 1 Jahr', daysAgo(400));
    await insert('erledigt vor 29 Tagen', daysAgo(100), daysAgo(29));
    await insert('erledigt vor genau 30 Tagen', daysAgo(100), daysAgo(30));
    await insert('erledigt vor 31 Tagen', daysAgo(40), daysAgo(31));

    expect(await purgeExpiredFeedback(s.pool, NOW)).toBe(4);
    expect(await messages()).toEqual(['neu, frisch', 'neu, 364 Tage alt', 'erledigt vor 29 Tagen']);
    // Zweiter Lauf: nichts mehr zu tun.
    expect(await purgeExpiredFeedback(s.pool, NOW)).toBe(0);
  });

  it('Status-Wechsel pflegt done_at: setzen, bei erneutem „erledigt“ behalten, beim Wiederöffnen leeren', async () => {
    const id = await insert('Bug', daysAgo(5));
    const doneAt = async () =>
      (await s.pool.query<FeedbackRow>('SELECT * FROM feedback WHERE id = $1', [id])).rows[0]?.done_at ?? null;

    await updateFeedbackStatus(s.pool, id, 'read');
    expect(await doneAt()).toBeNull();

    await updateFeedbackStatus(s.pool, id, 'done');
    const first = await doneAt();
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs((first?.getTime() ?? 0) - Date.now())).toBeLessThan(60_000);

    await s.pool.query('UPDATE feedback SET done_at = $2 WHERE id = $1', [id, daysAgo(3)]);
    await updateFeedbackStatus(s.pool, id, 'done');
    expect(await doneAt()).toEqual(daysAgo(3));

    await updateFeedbackStatus(s.pool, id, 'new');
    expect(await doneAt()).toBeNull();
  });

  it('Constraint: done_at genau dann gesetzt, wenn der Status „erledigt“ ist', async () => {
    await expect(
      s.pool.query(`INSERT INTO feedback (category, message, status) VALUES ('bug', 'x', 'done')`),
    ).rejects.toThrow(/feedback_done_at/);
    await expect(
      s.pool.query(`INSERT INTO feedback (category, message, status, done_at) VALUES ('bug', 'x', 'read', now())`),
    ).rejects.toThrow(/feedback_done_at/);
  });

  it('Job: löscht beim Start und danach in jedem Intervall (injizierte Uhr)', async () => {
    await insert('alt', daysAgo(400));
    await insert('bleibt', daysAgo(1));
    let now = NOW;
    const log = { info: vi.fn(), error: vi.fn() };
    const job = startFeedbackPurgeJob({ db: s.pool, log, now: () => now, intervalMs: 20 });
    try {
      await job.firstRun;
      expect(await messages()).toEqual(['bleibt']);
      expect(log.info).toHaveBeenCalledWith({ deleted: 1 }, expect.any(String));

      // Uhr ein Jahr weiter → der nächste Intervall-Lauf löscht auch den zweiten Eintrag.
      now = new Date(NOW.getTime() + 365 * DAY);
      await vi.waitFor(async () => {
        expect(await messages()).toEqual([]);
      });
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      job.stop();
    }
  });

  it('Job: Fehler werden geloggt, nicht geworfen', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const failing = { query: () => Promise.reject(new Error('DB weg')) };
    const job = startFeedbackPurgeJob({ db: failing, log, intervalMs: 60_000 });
    await job.firstRun;
    job.stop();
    expect(log.error).toHaveBeenCalledOnce();
  });
});
