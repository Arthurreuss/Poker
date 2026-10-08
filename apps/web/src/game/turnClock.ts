// Zug-Timer und Zeitbank im Client (WP-018, D-013): Timer laufen nur auf dem Server, der Client zeigt die
// Restzeit an. Grundlage: `TableView.turnClock` + `serverNowMs` (WP-012, ARCHITECTURE.md „Timer und
// Verbindungsmodell“). Zeitpunkte werden beim Empfang auf die lokale Uhr umgerechnet
// (Versatz = serverNowMs − lokale Zeit beim Empfang), damit Uhrabweichungen keine Rolle spielen.
import type { TableView as ServerTableView } from '@poker/engine/protocol';

/** Zug-Uhr in lokaler Zeit (ms seit Epoche nach `Date.now()` des Clients). */
export interface TurnClock {
  readonly seat: number;
  readonly startedMs: number;
  /** Ende der normalen Zugzeit. */
  readonly turnEndsMs: number;
  /** Automatische Aktion; liegt sie nach `turnEndsMs`, läuft dazwischen die Zeitbank. */
  readonly deadlineMs: number;
}

/**
 * Zug-Uhr aus der Server-Sicht, `receivedAtMs` = lokale Empfangszeit. `null`, wenn niemand am Zug ist
 * oder die Uhr nicht zur aktuellen Aktion passt.
 */
export function readTurnClock(table: ServerTableView, receivedAtMs: number): TurnClock | null {
  const clock = table.turnClock;
  const hand = table.round?.hand;
  if (clock === null || hand === null || hand === undefined || hand.phase !== 'betting') return null;
  if (clock.handNumber !== hand.handNumber || clock.actionSeq !== hand.actionSeq) return null;
  const offset = table.serverNowMs - receivedAtMs;
  return {
    seat: clock.seat,
    startedMs: clock.startedAtMs - offset,
    turnEndsMs: clock.turnEndsAtMs - offset,
    deadlineMs: clock.deadlineMs - offset,
  };
}

export interface TurnClockDisplay {
  /** Anteil 0–1 für den Ring: erst die normale Zugzeit, danach die Zeitbank. */
  readonly fraction: number;
  /** Restliche Zeitbank in ganzen Sekunden, solange sie läuft; sonst `undefined`. */
  readonly timeBankSeconds: number | undefined;
}

/** Anzeige zum lokalen Zeitpunkt `nowMs`. */
export function turnClockDisplay(clock: TurnClock, nowMs: number): TurnClockDisplay {
  const ratio = (left: number, total: number) => (total <= 0 ? 0 : Math.min(1, Math.max(0, left / total)));
  if (nowMs < clock.turnEndsMs || clock.deadlineMs <= clock.turnEndsMs) {
    const end = Math.min(clock.turnEndsMs, clock.deadlineMs);
    return { fraction: ratio(end - nowMs, clock.turnEndsMs - clock.startedMs), timeBankSeconds: undefined };
  }
  const left = Math.max(0, clock.deadlineMs - nowMs);
  return { fraction: ratio(left, clock.deadlineMs - clock.turnEndsMs), timeBankSeconds: Math.ceil(left / 1000) };
}
