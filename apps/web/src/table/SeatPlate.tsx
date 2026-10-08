import { DisconnectedSvg } from './assets/icons';
import { formatChips } from './format';
import type { SeatStatus } from './types';

export interface SeatPlateProps {
  readonly name: string;
  readonly stack: number;
  readonly status: SeatStatus;
  readonly connected: boolean;
  readonly toAct: boolean;
  /** Restzeit 0–1, nur relevant, wenn `toAct`; ohne Wert kein Timer-Ring (keine Daten vom Server). */
  readonly timeRemaining?: number | undefined;
  /** Restliche Zeitbank in Sekunden, solange sie läuft (D-013). */
  readonly timeBankSeconds?: number | undefined;
  readonly isHero?: boolean;
}

/**
 * Hinweis-Etikett über der Plakette: „Fold“ vor „Getrennt“. All-in und Ausgeschieden stehen
 * statt des Stacks in der zweiten Zeile; „getrennt“ zeigt zusätzlich immer ein Symbol am Namen.
 */
export function statusLabel(status: SeatStatus, connected: boolean): string | null {
  if (status === 'folded') return 'Fold';
  if (!connected && status !== 'eliminated') return 'Getrennt';
  return null;
}

/** Unter diesem Anteil wird der Timer-Ring rot. */
export const TIMER_LOW = 0.25;

/**
 * Timer-Ring um die Plakette (WP-018): Restzeit als Anteil des Umfangs, im Uhrzeigersinn ab oben links.
 * `pathLength` = 100, damit der Anteil direkt die Strichlänge ist.
 */
function TimerRing({ remaining }: { remaining: number }) {
  const percent = Math.round(remaining * 1000) / 10;
  return (
    <svg
      className={`pt-timer-ring${remaining < TIMER_LOW ? ' pt-timer-ring--low' : ''}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      data-testid="timer"
      role="progressbar"
      aria-label="Restzeit"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(remaining * 100)}
    >
      <rect className="pt-timer-track" x="1" y="1" width="98" height="98" rx="8" pathLength={100} />
      <rect
        className="pt-timer-arc"
        x="1"
        y="1"
        width="98"
        height="98"
        rx="8"
        pathLength={100}
        strokeDasharray={`${String(percent)} 100`}
      />
    </svg>
  );
}

/** Sitz-Plakette: Name, Stack, Status, Timer-Ring (sobald der Server eine Restzeit liefert) und Zeitbank. */
export function SeatPlate({
  name,
  stack,
  status,
  connected,
  toAct,
  timeRemaining,
  timeBankSeconds,
  isHero = false,
}: SeatPlateProps) {
  const pill = statusLabel(status, connected);
  const classes = [
    'pt-plate',
    isHero && 'pt-plate--hero',
    toAct && 'pt-plate--to-act',
    `pt-plate--${status}`,
    !connected && 'pt-plate--disconnected',
  ]
    .filter(Boolean)
    .join(' ');
  const remaining = timeRemaining === undefined ? null : Math.min(1, Math.max(0, timeRemaining));
  return (
    <div className={classes} data-testid="seat-plate">
      {pill !== null && (
        <span className={`pt-pill pt-pill--${pill === 'Fold' ? 'folded' : 'disconnected'}`} data-testid="status">
          {pill}
        </span>
      )}
      <div className="pt-plate-name">
        {!connected && (
          <span className="pt-plate-icon" role="img" aria-label="Verbindung getrennt">
            <DisconnectedSvg />
          </span>
        )}
        <span className="pt-text" data-testid="seat-name">
          {name}
        </span>
      </div>
      <div className="pt-plate-stack">
        <span className="pt-text" data-testid="seat-stack">
          {status === 'eliminated' ? 'Ausgeschieden' : status === 'allIn' ? 'All-in' : formatChips(stack)}
        </span>
      </div>
      {toAct && remaining !== null && <TimerRing remaining={remaining} />}
      {toAct && timeBankSeconds !== undefined && (
        <span className="pt-timebank" data-testid="time-bank">
          Zeitbank {timeBankSeconds} s
        </span>
      )}
    </div>
  );
}
