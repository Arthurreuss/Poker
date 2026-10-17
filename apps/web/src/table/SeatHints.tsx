// Hinweise an der Sitz-Plakette (WP-037): Zug-Timer (Ring + Sekunden), letzte Aktion als Schriftzug und
// der Name der eigenen besten Hand. Reine Darstellung; Stile in `seat-hints.css`.
import type { CSSProperties } from 'react';
import { formatChips } from './format';
import type { HeroHandView, LastActionView } from './types';

/** Ab diesem Anteil Restzeit wird der Timer gelb, darunter (`TIMER_LOW`) rot. */
export const TIMER_MID = 0.5;
/** Unter diesem Anteil wird der Timer rot. */
export const TIMER_LOW = 0.25;

/** Farbstufe des Timers: normal, gelb, rot oder Zeitbank (eigene Farbe). */
export type TimerStage = 'ok' | 'mid' | 'low' | 'bank';

export function timerStage(remaining: number, timeBank: boolean): TimerStage {
  if (timeBank) return 'bank';
  if (remaining < TIMER_LOW) return 'low';
  if (remaining < TIMER_MID) return 'mid';
  return 'ok';
}

/** Schriftzug der letzten Aktion, z. B. „Check“, „Bet 40“, „Raise 120“ (Raise = auf diesen Betrag). */
export function lastActionText(action: LastActionView): string {
  switch (action.kind) {
    case 'check':
      return 'Check';
    case 'fold':
      return 'Fold';
    case 'call':
      return 'Call';
    case 'allIn':
      return 'All-in';
    case 'bet':
      return `Bet ${formatChips(action.amount)}`;
    case 'raise':
      return `Raise ${formatChips(action.amount)}`;
  }
}

/** Schriftzug über der Plakette (an der Stelle des Etiketts „Fold“/„Getrennt“). */
export function ActionTag({ action }: { action: LastActionView }) {
  return (
    <span className={`pt-pill pt-action-tag pt-action-tag--${action.kind}`} data-testid="last-action">
      {lastActionText(action)}
    </span>
  );
}

/**
 * Zug-Timer als Rahmen der Plakette (WP-018, seit WP-037 die Hervorhebung selbst): der farbige Rahmen des Spielers
 * am Zug läuft im Uhrzeigersinn ab 12 Uhr ab; der abgelaufene Teil sieht aus wie ein normaler Rahmen. Liegt genau
 * auf dem Rahmen der Plakette (kein zweiter Ring); gezeichnet per CSS (`--pt-remaining` 0–1, `seat-hints.css`).
 */
export function TimerRing({ remaining, stage }: { remaining: number; stage: TimerStage }) {
  return (
    <span
      className={`pt-timer-ring pt-timer-ring--${stage}`}
      style={{ '--pt-remaining': String(remaining) } as CSSProperties}
      data-testid="timer"
      data-stage={stage}
      role="progressbar"
      aria-label={stage === 'bank' ? 'Restzeit der Zeitbank' : 'Restzeit'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remaining * 100)}
    />
  );
}

/** Sekunden unter der Plakette: „12 s“ bzw. „Zeitbank 42 s“. */
export function TurnClockTag({ seconds, stage }: { seconds: number; stage: TimerStage }) {
  return (
    <span
      className={`pt-clock pt-clock--${stage}`}
      data-testid={stage === 'bank' ? 'time-bank' : 'turn-clock'}
      data-stage={stage}
    >
      {stage === 'bank' ? `Zeitbank ${String(seconds)} s` : `${String(seconds)} s`}
    </span>
  );
}

/** Name der eigenen besten Hand unter der eigenen Plakette. */
export function HeroHandTag({ hand }: { hand: HeroHandView }) {
  return (
    <span className="pt-hero-hand" data-testid="hero-hand" title={hand.long}>
      {hand.short}
    </span>
  );
}
