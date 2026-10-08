import { Card } from './Card';
import './reveal.css';
import type { Card as CardValue } from './types';

/**
 * Aufdecken verdeckter Karten durch einen Admin (WP-033, D-027): Die Tischansicht bekommt die aufgedeckten Karten je
 * Platz und meldet Tipps. Nur im Client des Admins gesetzt; ohne diese Prop bleibt die Ansicht unverändert.
 */
export interface CardReveal {
  /** Platz → bekannte Karten (vom Server erhalten, laufende Hand). */
  readonly cards: ReadonlyMap<number, readonly CardValue[]>;
  /** Plätze, deren Karten gerade aufgedeckt sind. */
  readonly faceUp: ReadonlySet<number>;
  readonly onToggle: (seat: number) => void;
}

export interface RevealableCardsProps {
  readonly seat: number;
  readonly name: string;
  readonly reveal: CardReveal;
  readonly fourColor: boolean;
}

/**
 * Verdeckte Karten eines Mitspielers als Schalter: Tippen dreht sie um (Rückseite → Vorderseite), erneutes Tippen
 * zurück. Beide Seiten liegen übereinander; die Drehung macht CSS (`pt-flip`, nur mit Animationen).
 */
export function RevealableCards({ seat, name, reveal, fourColor }: RevealableCardsProps) {
  const cards = reveal.cards.get(seat);
  const up = cards !== undefined && reveal.faceUp.has(seat);
  return (
    <button
      type="button"
      className={`pt-seat-cards pt-seat-cards--hidden pt-seat-cards--revealable${up ? ' pt-seat-cards--revealed' : ''}`}
      data-testid="hole-cards"
      data-kind="hidden"
      data-revealed={up ? 'true' : 'false'}
      aria-pressed={up}
      aria-label={up ? `Karten von ${name} verdecken` : `Karten von ${name} aufdecken`}
      onClick={() => {
        reveal.onToggle(seat);
      }}
    >
      {[0, 1].map((i) => {
        const card = cards?.[i];
        return (
          <span key={i} className={`pt-flip${up ? ' pt-flip--up' : ''}`}>
            <span className="pt-flip-side pt-flip-back" aria-hidden={up}>
              <Card size="seat" />
            </span>
            {card !== undefined && (
              <span className="pt-flip-side pt-flip-face" aria-hidden={!up}>
                <Card card={card} size="seat" fourColor={fourColor} />
              </span>
            )}
          </span>
        );
      })}
    </button>
  );
}
