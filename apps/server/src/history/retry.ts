// Retry für Schreibvorgänge der Historie (WP-013). Speicherfehler halten das Spiel nie an: Schreibvorgänge
// laufen in der Hook-Warteschlange des Tisches (WP-011), ein Retry verzögert nur die folgenden Schreibvorgänge
// dieses Tisches. Nach dem letzten Versuch wird der Fehler geworfen (und vom Tisch geloggt).
import type { TableRepository } from '../game/repository';
import type { Logger } from '../game/table';

/** Wartezeiten vor dem 2., 3. und 4. Versuch: insgesamt höchstens ~21 s pro Schreibvorgang. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000];

export interface RetryOptions {
  /** Wartezeit vor jedem weiteren Versuch; Länge = Anzahl Wiederholungen. */
  delaysMs: readonly number[];
  log: Logger;
  /** Standard: `setTimeout` (unref). Tests können sofort zurückkehren. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

/**
 * Deterministische Fehler wiederholen sich bei jedem Versuch – kein Retry: SQLSTATE-Klassen 22 (ungültige Daten),
 * 23 (Constraint verletzt) und 42 (Syntax, unbekannte Spalte). Alles andere (Verbindung weg, Timeout,
 * DB-Neustart, Deadlock) wird wiederholt.
 */
export function isRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return true;
  return !['22', '23', '42'].includes(code.slice(0, 2));
}

/** Führt `fn` aus und wiederholt es bei vorübergehenden Fehlern. `fn` muss idempotent sein. */
export async function withRetry<T>(
  task: string,
  context: object,
  fn: () => Promise<T>,
  { delaysMs, log, sleep = defaultSleep }: RetryOptions,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const delay = delaysMs[attempt - 1];
      if (delay === undefined || !isRetryable(error)) {
        throw new Error(`${task} fehlgeschlagen (${String(attempt)} Versuch(e))`, { cause: error });
      }
      log.warn({ err: error, ...context, task, attempt, retryInMs: delay }, 'Speichern fehlgeschlagen – neuer Versuch');
      await sleep(delay);
    }
  }
}

/**
 * Repository mit Retry für das Rundenergebnis (`finishRound`, idempotentes UPDATE). `startRound` bleibt ohne
 * Retry: schlägt es fehl, bekommt der Ersteller sofort einen Fehler und der Tisch bleibt offen (WP-011).
 */
export function withFinishRoundRetry(repository: TableRepository, options: RetryOptions): TableRepository {
  return {
    createTable: (table) => repository.createTable(table),
    startRound: (tableId, players) => repository.startRound(tableId, players),
    closeTable: (tableId) => repository.closeTable(tableId),
    finishRound: (tableId, roundId, results) =>
      withRetry('finishRound', { tableId, roundId }, () => repository.finishRound(tableId, roundId, results), options),
  };
}
