import { CardBackSvg, CardFaceSvg } from './assets/CardSvg';
import { cardName } from './format';
import type { Card as CardValue } from './types';

export type CardSize = 'seat' | 'board' | 'hero';

export interface CardProps {
  /** Ohne Karte wird die Rückseite gezeigt (verdeckte Karte). */
  readonly card?: CardValue | undefined;
  readonly size: CardSize;
  readonly fourColor?: boolean;
  readonly className?: string;
}

/** Eine Spielkarte (Vorder- oder Rückseite); Größe skaliert mit dem Tisch-Container. */
export function Card({ card, size, fourColor = false, className }: CardProps) {
  const classes = ['pt-card', `pt-card--${size}`, card === undefined ? 'pt-card--back' : 'pt-card--face', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      role="img"
      aria-label={card === undefined ? 'verdeckte Karte' : cardName(card)}
      data-card={card ?? 'back'}
    >
      {card === undefined ? <CardBackSvg /> : <CardFaceSvg card={card} fourColor={fourColor} />}
    </div>
  );
}
