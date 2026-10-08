/**
 * Tisch-Ereignisse aus zwei aufeinanderfolgenden Ansichten (WP-031): Grundlage für Animationen
 * (`TableFx`) und Sounds (`useTableSounds`). Rein und unit-getestet; der Server bleibt die Wahrheit –
 * Ereignisse sind nur Darstellung und werden aus dem Unterschied zweier `TableView`s abgeleitet.
 */
import type { PlayerSeatView, TableView } from '../types';

export type TableEvent =
  /** Neue Hand: Karten an diese Sitze (in Austeil-Reihenfolge ab links vom Button). */
  | { readonly type: 'deal'; readonly seats: readonly number[] }
  /** Board-Karten mit Index `from` … `to - 1` sind neu. */
  | { readonly type: 'board'; readonly from: number; readonly to: number }
  | { readonly type: 'bet'; readonly seat: number; readonly allIn: boolean }
  | { readonly type: 'check'; readonly seat: number }
  | { readonly type: 'fold'; readonly seat: number }
  /** Einsätze dieser Sitze wandern in den Pot (Straße bzw. Hand zu Ende). */
  | { readonly type: 'collect'; readonly seats: readonly number[] }
  /** Karten im Showdown aufgedeckt. */
  | { readonly type: 'reveal'; readonly seat: number }
  /** Pot(s) an diese Sitze; `hero` = der eigene Sitz ist dabei. */
  | { readonly type: 'win'; readonly seats: readonly number[]; readonly hero: boolean }
  /** Der eigene Spieler ist jetzt am Zug. */
  | { readonly type: 'yourTurn' };

function player(view: TableView, seat: number): PlayerSeatView | null {
  const s = view.seats[seat];
  return s?.kind === 'player' ? s : null;
}

/** Sitze in Austeil-Reihenfolge: ab dem ersten Sitz links vom Button, im Uhrzeigersinn. */
function dealOrder(view: TableView, seats: number[]): number[] {
  const start = view.buttonSeat ?? -1;
  const n = view.seats.length;
  return [...seats].sort((a, b) => ((a - start - 1 + n) % n) - ((b - start - 1 + n) % n));
}

/**
 * Ereignisse zwischen `prev` und `next`. Ohne vorherige Ansicht (erster Stand, Reconnect) gibt es keine –
 * der Tisch erscheint dann einfach im aktuellen Zustand.
 */
export function diffTableViews(prev: TableView | null, next: TableView): TableEvent[] {
  if (prev === null) return [];
  const events: TableEvent[] = [];
  const newHand = next.handNumber !== undefined && next.handNumber !== prev.handNumber;
  const seatCount = next.seats.length;

  if (newHand) {
    const dealt: number[] = [];
    for (let seat = 0; seat < seatCount; seat++) {
      const p = player(next, seat);
      if (p !== null && p.holeCards.kind !== 'none') dealt.push(seat);
    }
    if (dealt.length > 0) events.push({ type: 'deal', seats: dealOrder(next, dealt) });
    for (let seat = 0; seat < seatCount; seat++) {
      if ((player(next, seat)?.bet ?? 0) > 0) {
        events.push({ type: 'bet', seat, allIn: player(next, seat)?.status === 'allIn' });
      }
    }
  } else if (next.handNumber !== undefined) {
    const collected: number[] = [];
    for (let seat = 0; seat < seatCount; seat++) {
      const a = player(prev, seat);
      const b = player(next, seat);
      if (a === null || b === null) continue;
      if (b.bet > a.bet) events.push({ type: 'bet', seat, allIn: b.status === 'allIn' });
      else if (a.bet > 0 && b.bet === 0) collected.push(seat);
      if (a.status !== 'folded' && b.status === 'folded') events.push({ type: 'fold', seat });
      if (a.holeCards.kind === 'hidden' && b.holeCards.kind === 'shown') events.push({ type: 'reveal', seat });
      if (
        prev.toActSeat === seat &&
        next.toActSeat !== seat &&
        a.status === 'active' &&
        b.status === 'active' &&
        a.stack === b.stack &&
        b.bet <= a.bet
      ) {
        events.push({ type: 'check', seat });
      }
    }
    if (collected.length > 0) events.push({ type: 'collect', seats: collected });
    if (next.board.length > prev.board.length) {
      events.push({ type: 'board', from: prev.board.length, to: next.board.length });
    }
  }

  const winners = next.winnerSeats ?? [];
  const hadWinners = !newHand && (prev.winnerSeats?.length ?? 0) > 0;
  if (winners.length > 0 && !hadWinners) {
    events.push({
      type: 'win',
      seats: winners,
      hero: next.heroSeat !== null && winners.includes(next.heroSeat),
    });
  }

  if (next.heroSeat !== null && next.toActSeat === next.heroSeat && (prev.toActSeat !== next.toActSeat || newHand)) {
    events.push({ type: 'yourTurn' });
  }
  return events;
}
