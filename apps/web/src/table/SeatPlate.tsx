import { DisconnectedSvg } from './assets/icons';
import { formatChips } from './format';
import type { SeatStatus } from './types';

export interface SeatPlateProps {
  readonly name: string;
  readonly stack: number;
  readonly status: SeatStatus;
  readonly connected: boolean;
  readonly toAct: boolean;
  /** Restzeit 0–1, nur relevant, wenn `toAct`. */
  readonly timeRemaining?: number | undefined;
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

/** Sitz-Plakette: Name, Stack, Status und Platzhalter für den Timer (Ring folgt in WP-018). */
export function SeatPlate({ name, stack, status, connected, toAct, timeRemaining, isHero = false }: SeatPlateProps) {
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
  const remaining = timeRemaining === undefined ? 1 : Math.min(1, Math.max(0, timeRemaining));
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
      {toAct && (
        <div
          className="pt-timer"
          data-testid="timer"
          role="progressbar"
          aria-label="Restzeit"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(remaining * 100)}
        >
          <div className="pt-timer-fill" style={{ width: `${String(remaining * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
