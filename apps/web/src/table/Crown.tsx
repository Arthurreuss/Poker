import './showdown.css';

/**
 * Krone am Platz eines Gewinners (WP-039), „aufgesetzt“ auf den Avatar: erscheint, sobald `TableView.winnerSeats`
 * den Sitz enthält – also erst, wenn der Client das Ergebnis zeigt (nach dem Aufdecken bzw. Runout,
 * `game/presentation.ts`). Bei einem Split-Pot tragen alle Gewinner eine. Eingeblendet per CSS (nur mit
 * Animationen), sonst sofort sichtbar.
 */
export interface CrownProps {
  readonly name: string;
  /** Obere Ecke der Plakette, an der der Avatar sitzt (bzw. säße). */
  readonly side: 'left' | 'right';
  /** Mit Avatar sitzt die Krone auf dessen Kopf, sonst auf der Ecke der Plakette. */
  readonly onAvatar: boolean;
}

export function Crown({ name, side, onAvatar }: CrownProps) {
  const classes = ['pt-crown', `pt-crown--${side}`, !onAvatar && 'pt-crown--bare'].filter(Boolean).join(' ');
  return (
    <span className={classes} role="img" aria-label={`${name} gewinnt`} data-testid="winner-crown">
      <svg viewBox="0 0 64 48" aria-hidden="true" focusable="false">
        <path className="pt-crown-body" d="M6 16 L18 28 L32 6 L46 28 L58 16 L53 40 Q32 46 11 40 Z" />
        <circle className="pt-crown-body" cx="6" cy="14" r="4" />
        <circle className="pt-crown-body" cx="32" cy="5" r="4" />
        <circle className="pt-crown-body" cx="58" cy="14" r="4" />
        <circle className="pt-crown-gem" cx="32" cy="33" r="4" />
        <circle className="pt-crown-gem" cx="20" cy="35" r="2.6" />
        <circle className="pt-crown-gem" cx="44" cy="35" r="2.6" />
        <path className="pt-crown-shine" d="M15 33 Q32 37 49 33 L48 36 Q32 40 16 36 Z" />
      </svg>
    </span>
  );
}
