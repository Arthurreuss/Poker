// Replay einer gespeicherten Hand (WP-013): Ausgangslage (Spieler, Button, Blind-Sitze, Deck) und Aktionen
// gehen durch die Engine (`replayHand`); das Ergebnis wird wieder in die gespeicherte Form gebracht. Stimmt es
// mit dem gespeicherten Datensatz überein, ist die Historie vollständig und konsistent.
import { replayHand, type HandState } from '@poker/engine';
import { toHandRecord, toReplayEvent, type HandRecord } from './records';

export type ReplayResult = { ok: true; state: HandState; record: HandRecord } | { ok: false; message: string };

/** Spielt eine gespeicherte, beendete Hand mit demselben Deck neu und liefert Endzustand und neu erzeugten Datensatz. */
export function replayHandRecord(stored: HandRecord): ReplayResult {
  if (stored.result === null) return { ok: false, message: 'Hand ist nicht beendet (kein Ergebnis gespeichert)' };
  const replayed = replayHand(
    {
      players: stored.players.map((p) => ({ id: String(p.userId), seat: p.seat, stack: p.stack })),
      buttonSeat: stored.buttonSeat,
      smallBlind: stored.smallBlind,
      bigBlind: stored.bigBlind,
      blinds: { smallBlindSeat: stored.smallBlindSeat, bigBlindSeat: stored.bigBlindSeat },
      deck: stored.deck,
    },
    stored.actions.map(toReplayEvent),
  );
  if (!replayed.ok) return { ok: false, message: replayed.error.message };
  // Ob eine Aktion automatisch war, weiß die Engine nicht – die Markierung wird übernommen.
  const autoSeqs = stored.actions.filter((a) => a.isAutomatic).map((a) => a.seq);
  if (replayed.state.phase !== 'complete') return { ok: false, message: 'Aktionen enden vor dem Ende der Hand' };
  return {
    ok: true,
    state: replayed.state,
    record: toHandRecord(stored.roundId, stored.handNumber, replayed.state, autoSeqs),
  };
}
