// Speicherdauer von Feedback (WP-022, D-025): erledigtes Feedback 30 Tage nach dem Erledigen löschen, jedes Feedback
// spätestens 1 Jahr nach dem Absenden. Läuft im Server beim Start und danach täglich (main.ts).
import type { FastifyBaseLogger } from 'fastify';
import type { Queryable } from '../db';
import { startPeriodicJob, type PeriodicJob } from '../periodic-job';

const DAY_MS = 86_400_000;

export interface FeedbackRetention {
  /** Erledigtes Feedback wird so viele Tage nach `done_at` gelöscht. */
  doneDays: number;
  /** Jedes Feedback wird so viele Tage nach `created_at` gelöscht. */
  maxDays: number;
}

/** Fristen laut D-025 bzw. Datenschutzerklärung (Abschnitt „Feedback“) – bei Änderung beide anpassen. */
export const FEEDBACK_RETENTION: FeedbackRetention = { doneDays: 30, maxDays: 365 };

/** Wie oft der Job läuft (zusätzlich einmal beim Start). */
export const FEEDBACK_PURGE_INTERVAL_MS = DAY_MS;

/** Löscht abgelaufenes Feedback (Stichtag `now`) und liefert die Anzahl gelöschter Einträge. */
export async function purgeExpiredFeedback(
  db: Queryable,
  now: Date,
  retention: FeedbackRetention = FEEDBACK_RETENTION,
): Promise<number> {
  const doneBefore = new Date(now.getTime() - retention.doneDays * DAY_MS);
  const createdBefore = new Date(now.getTime() - retention.maxDays * DAY_MS);
  const { rowCount } = await db.query(
    `DELETE FROM feedback
      WHERE (done_at IS NOT NULL AND done_at <= $1)
         OR created_at <= $2`,
    [doneBefore, createdBefore],
  );
  return rowCount ?? 0;
}

export interface FeedbackPurgeJobOptions {
  db: Queryable;
  log: Pick<FastifyBaseLogger, 'info' | 'error'>;
  /** Standard: echte Uhr. */
  now?: () => Date;
  /** Standard: `FEEDBACK_PURGE_INTERVAL_MS` (täglich). */
  intervalMs?: number;
  retention?: FeedbackRetention;
}

/** Siehe `PeriodicJob` (erster Lauf, `stop`). */
export type FeedbackPurgeJob = PeriodicJob;

/**
 * Startet den Löschjob: sofort ein Lauf, danach alle `intervalMs`. Fehler (z. B. DB kurz weg) werden geloggt, der
 * nächste Lauf versucht es erneut. Der Timer hält den Prozess nicht am Leben (`unref`).
 */
export function startFeedbackPurgeJob({
  db,
  log,
  now = () => new Date(),
  intervalMs = FEEDBACK_PURGE_INTERVAL_MS,
  retention = FEEDBACK_RETENTION,
}: FeedbackPurgeJobOptions): FeedbackPurgeJob {
  return startPeriodicJob({
    intervalMs,
    run: async () => {
      const deleted = await purgeExpiredFeedback(db, now(), retention);
      if (deleted > 0) log.info({ deleted }, 'Feedback: abgelaufene Einträge gelöscht (D-025)');
    },
    onError: (err) => {
      log.error({ err }, 'Feedback: Löschen abgelaufener Einträge fehlgeschlagen');
    },
  });
}
