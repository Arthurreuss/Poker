// Zeitliche Darstellung einer Hand (WP-031): Liefert der Server einen All-in-Runout auf einmal (Hand
// fertig, mehrere Straßen neu), deckt der Client Flop, Turn und River nacheinander auf und zeigt das
// Ergebnis (Auszahlung, Gewinner) erst danach. Bei einem Showdown (WP-039) drehen sich vorher die Karten der
// Mitspieler um (ca. 1 s, `TableFx`); Gewinner, Krone und Auszahlung erscheinen erst danach – auch ohne
// Animationen, damit der Zeitablauf gleich bleibt. Der Server bleibt die Wahrheit (D-003): Das ist nur eine
// kurze, begrenzte Verzögerung der Anzeige; ein neuer Stand einer anderen Hand beendet sie sofort.
// Die Server-Pause nach der Hand ist dafür bei einem Showdown (`DEFAULT_SHOWDOWN_PAUSE_MS`) und je
// Runout-Straße (`DEFAULT_RUNOUT_PAUSE_MS`) länger.
import { useEffect, useState } from 'react';
import type { HandView } from '@poker/engine/protocol';
import type { Reveal } from './adapter';

/** Abstand zwischen Flop, Turn und River beim Runout. */
export const RUNOUT_STEP_MS = 900;
/** Pause nach der letzten aufgedeckten Straße, bis das Ergebnis erscheint. */
export const RESULT_DELAY_MS = 700;
/**
 * Showdown (WP-039): so lange drehen sich die Karten der Mitspieler um (Flip in `TableFx`), bevor ein Runout
 * beginnt bzw. das Ergebnis erscheint. Etwas länger als die Animation (ca. 1 s), damit man die Karten sieht.
 */
export const SHOWDOWN_FLIP_MS = 1200;

export interface RevealStep {
  readonly atMs: number;
  readonly reveal: Reveal;
}

/** Was von einer Hand gerade gezeigt wird; `reveal.result` nur, wenn das Ergebnis einer fertigen Hand sichtbar ist. */
export interface Seen {
  readonly handNumber: number;
  readonly reveal: Reveal;
}

type HandLike = Pick<HandView, 'handNumber' | 'board' | 'phase' | 'showdown'>;

/**
 * Plan für die nächste Sicht: erster Schritt sofort (`atMs` 0), weitere zeitversetzt. Gestaffelt wird nur,
 * wenn die Hand gerade fertig geworden ist und es einen Showdown gab (erst Karten umdrehen, dann Runout,
 * dann Ergebnis) bzw. dabei neue Straßen ausgeteilt wurden (Runout); sonst alles sofort.
 * `seen = null` (erster Stand, Seite neu geladen): alles sofort.
 */
export function planReveal(seen: Seen | null, hand: HandLike | null): RevealStep[] {
  if (hand === null) return [];
  const full: Reveal = { board: hand.board.length, result: true };
  if (seen === null) return [{ atMs: 0, reveal: full }];
  const start: Reveal = seen.handNumber === hand.handNumber ? seen.reveal : { board: 0, result: false };
  if (start.result && seen.handNumber === hand.handNumber) return [{ atMs: 0, reveal: full }];
  const streets = [3, 4, 5].filter((n) => n > start.board && n <= hand.board.length);
  const showdown = hand.showdown !== null;
  if (hand.phase !== 'complete' || (streets.length === 0 && !showdown)) return [{ atMs: 0, reveal: full }];
  // Showdown: Karten drehen sich um, Board steht noch wie zuletzt gesehen; erst danach Runout bzw. Ergebnis.
  const flip = showdown ? SHOWDOWN_FLIP_MS : 0;
  const steps: RevealStep[] = showdown ? [{ atMs: 0, reveal: { board: start.board, result: false } }] : [];
  streets.forEach((board, i) => {
    steps.push({ atMs: flip + i * RUNOUT_STEP_MS, reveal: { board, result: false } });
  });
  const resultAt = streets.length === 0 ? flip : flip + (streets.length - 1) * RUNOUT_STEP_MS + RESULT_DELAY_MS;
  steps.push({ atMs: resultAt, reveal: full });
  return steps;
}

interface RevealState {
  readonly key: string;
  readonly handNumber: number | null;
  readonly complete: boolean;
  readonly steps: readonly RevealStep[];
  readonly index: number;
}

function keyOf(hand: HandLike | null): string {
  return hand === null
    ? '-'
    : `${String(hand.handNumber)}/${String(hand.board.length)}/${hand.phase}/${hand.showdown === null ? '' : 'sd'}`;
}

function seenOf(state: RevealState): Seen | null {
  const step = state.steps[state.index];
  if (state.handNumber === null || step === undefined) return null;
  return {
    handNumber: state.handNumber,
    reveal: { board: step.reveal.board, result: state.complete && step.reveal.result },
  };
}

function plan(prev: RevealState | null, hand: HandLike | null): RevealState {
  return {
    key: keyOf(hand),
    handNumber: hand?.handNumber ?? null,
    complete: hand?.phase === 'complete',
    steps: planReveal(prev === null ? null : seenOf(prev), hand),
    index: 0,
  };
}

/**
 * Aktuelle Teil-Sicht der Hand für `toTableView(…, { reveal })`; `null` = alles zeigen.
 * `resultShown` = Ergebnis ist sichtbar (für die Showdown-Pause vor dem Rundenende-Dialog).
 */
export function useHandReveal(hand: HandLike | null): { reveal: Reveal | null; resultShown: boolean } {
  const [state, setState] = useState<RevealState>(() => plan(null, hand));
  let current = state;
  if (state.key !== keyOf(hand)) {
    // Neuer Stand: sofort (noch in diesem Render) neu planen, damit nie ein veralteter Ausschnitt erscheint.
    current = plan(state, hand);
    setState(current);
  }
  const { key, index, steps } = current;
  useEffect(() => {
    const step = steps[index];
    const next = steps[index + 1];
    if (step === undefined || next === undefined) return undefined;
    const id = setTimeout(() => {
      setState((s) => (s.key === key && s.index === index ? { ...s, index: index + 1 } : s));
    }, next.atMs - step.atMs);
    return () => {
      clearTimeout(id);
    };
  }, [key, index, steps]);
  const reveal = current.steps[current.index]?.reveal ?? null;
  return { reveal, resultShown: reveal === null || reveal.result };
}
