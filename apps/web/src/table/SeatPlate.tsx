import { Avatar } from '../avatars/Avatar';
import { DisconnectedSvg } from './assets/icons';
import { formatChips } from './format';
import { ActionTag, HeroHandTag, TimerRing, TurnClockTag, timerStage } from './SeatHints';
import type { HeroHandView, LastActionView, SeatStatus } from './types';

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
  /** Restsekunden für die Anzeige unter der Plakette (WP-037). */
  readonly timeSeconds?: number | undefined;
  /** Letzte Aktion der Straße als Schriftzug (WP-037); „Fold“ zeigt weiter das Etikett. */
  readonly lastAction?: LastActionView | undefined;
  /** Name der eigenen besten Hand unter der Plakette (WP-037, nur eigener Sitz). */
  readonly heroHand?: HeroHandView | undefined;
  readonly isHero?: boolean;
  /** Avatar-ID (WP-032); ohne Wert kein Avatar an der Plakette. */
  readonly avatar?: string | null | undefined;
  /** Seite, an der der Avatar über den Rand ragt (gegenüber Dealer-Button/Blind-Marker). */
  readonly avatarSide?: 'left' | 'right';
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

/**
 * Sitz-Plakette: Name, Stack, Status bzw. letzte Aktion, Timer-Ring mit Sekunden (sobald der Server eine
 * Restzeit liefert), Zeitbank und – am eigenen Sitz – der Name der besten Hand.
 */
export function SeatPlate({
  name,
  stack,
  status,
  connected,
  toAct,
  timeRemaining,
  timeBankSeconds,
  timeSeconds,
  lastAction,
  heroHand,
  isHero = false,
  avatar,
  avatarSide = 'left',
}: SeatPlateProps) {
  const hasAvatar = avatar !== undefined && avatar !== null;
  const pill = statusLabel(status, connected);
  const remaining = timeRemaining === undefined ? null : Math.min(1, Math.max(0, timeRemaining));
  const stage = remaining === null ? null : timerStage(remaining, timeBankSeconds !== undefined);
  const classes = [
    'pt-plate',
    isHero && 'pt-plate--hero',
    toAct && 'pt-plate--to-act',
    // Läuft ein Timer, ist der Rahmen der Hervorhebung selbst der Timer (WP-037): Farbe je Stufe.
    toAct && stage !== null && `pt-plate--timed pt-plate--timer-${stage}`,
    `pt-plate--${status}`,
    !connected && 'pt-plate--disconnected',
    hasAvatar && `pt-plate--avatar-${avatarSide}`,
  ]
    .filter(Boolean)
    .join(' ');
  const clockSeconds = timeBankSeconds ?? timeSeconds;
  const clock = toAct && stage !== null && clockSeconds !== undefined ? { seconds: clockSeconds, stage } : null;
  // „Fold“ bleibt das Etikett; sonst hat die letzte Aktion Vorrang vor „Getrennt“ (Symbol am Namen bleibt).
  const action = status === 'folded' ? undefined : lastAction;
  return (
    <div className={classes} data-testid="seat-plate">
      {action !== undefined && <ActionTag action={action} />}
      {action === undefined && pill !== null && (
        <span className={`pt-pill pt-pill--${pill === 'Fold' ? 'folded' : 'disconnected'}`} data-testid="status">
          {pill}
        </span>
      )}
      {hasAvatar && (
        <Avatar avatar={avatar} name={name} decorative className={`pt-plate-avatar pt-plate-avatar--${avatarSide}`} />
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
      {toAct && remaining !== null && stage !== null && <TimerRing remaining={remaining} stage={stage} />}
      {(clock !== null || heroHand !== undefined) && (
        <div className="pt-plate-foot">
          {clock !== null && <TurnClockTag seconds={clock.seconds} stage={clock.stage} />}
          {heroHand !== undefined && <HeroHandTag hand={heroHand} />}
        </div>
      )}
    </div>
  );
}
