// Hand-Historie über die Game-Hooks (WP-011 → WP-013): jede Hand wird zu Beginn angelegt (Spieler, Hole Cards,
// Deck, Blinds) und am Ende ergänzt (Board, Aktionen, Ergebnis). Die Hooks laufen pro Tisch nacheinander und
// bremsen das Spiel nicht; Fehler werden nach den Retries geloggt, der Tisch spielt weiter.
import type { GameHooks } from '../game/hooks';
import { toHandRecord } from './records';
import { withRetry, type RetryOptions } from './retry';
import type { HandHistoryStore } from './store';

export function createHandHistoryHooks(store: HandHistoryStore, retry: RetryOptions): GameHooks {
  return {
    async onHandStarted({ tableId, roundId, handNumber, hand }) {
      const record = toHandRecord(roundId, handNumber, hand);
      await withRetry('saveHandStarted', { tableId, roundId, handNumber }, () => store.saveHandStarted(record), retry);
    },
    async onHandComplete({ tableId, roundId, handNumber, hand }) {
      const record = toHandRecord(roundId, handNumber, hand);
      await withRetry(
        'saveHandCompleted',
        { tableId, roundId, handNumber },
        () => store.saveHandCompleted(record),
        retry,
      );
    },
    // Rundenende: Platzierungen und Punkte schreibt das Repository (`finishRound`, mit Retry über
    // `withFinishRoundRetry`), direkt nach diesem Hook in derselben Warteschlange.
  };
}

/** Mehrere Hook-Sätze nacheinander ausführen; ein Fehler in einem hindert die anderen nicht. */
export function combineHooks(...sets: GameHooks[]): GameHooks {
  const run =
    <K extends keyof GameHooks>(name: K) =>
    async (event: Parameters<NonNullable<GameHooks[K]>>[0]): Promise<void> => {
      const errors: unknown[] = [];
      for (const set of sets) {
        const hook = set[name] as ((e: typeof event) => void | Promise<void>) | undefined;
        try {
          await hook?.(event);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, `${name}: ${String(errors.length)} Hooks fehlgeschlagen`);
    };
  return {
    onHandStarted: run('onHandStarted'),
    onHandComplete: run('onHandComplete'),
    onRoundComplete: run('onRoundComplete'),
  };
}
