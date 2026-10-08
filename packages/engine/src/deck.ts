import { RANKS, SUITS, makeCard, type Card } from './cards';
import type { Rng } from './rng';

/** Alle 52 Karten in fester Reihenfolge (Farbe für Farbe, Ränge aufsteigend). */
export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => makeCard(rank, suit)));
}

/** Fisher-Yates-Shuffle; gibt ein neues Array zurück, die Eingabe bleibt unverändert. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = result[i] as T;
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return result;
}

/** Frisch gemischtes 52-Karten-Deck. */
export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(createDeck(), rng);
}

export interface DealResult {
  /** Ausgeteilte Karten (von oben, also vom Anfang des Arrays). */
  cards: Card[];
  /** Restliches Deck. */
  deck: Card[];
}

/** Teilt `count` Karten von oben aus; reine Funktion, das Eingabe-Deck bleibt unverändert. */
export function deal(deck: readonly Card[], count: number): DealResult {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError(`Anzahl muss eine nicht-negative ganze Zahl sein, war ${String(count)}`);
  }
  if (count > deck.length) {
    throw new RangeError(`Nicht genug Karten: ${String(count)} angefordert, ${String(deck.length)} im Deck`);
  }
  return { cards: deck.slice(0, count), deck: deck.slice(count) };
}
