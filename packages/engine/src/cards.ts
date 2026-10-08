/**
 * Karten als kompakte Strings: Rang + Farbe, z. B. `"As"`, `"Td"`, `"2c"`.
 * Begründung der Darstellung: ARCHITECTURE.md, Abschnitt „Engine: Karten und Zufall“.
 */

/** Ränge aufsteigend, `T` = Zehn. */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
/** Farben: Kreuz (clubs), Karo (diamonds), Herz (hearts), Pik (spades). */
export const SUITS = ['c', 'd', 'h', 's'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];
/** Eine Karte, JSON-serialisierbar als String, z. B. `"As"`. */
export type Card = `${Rank}${Suit}`;

export class CardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardParseError';
  }
}

const RANK_SET: ReadonlySet<string> = new Set(RANKS);
const SUIT_SET: ReadonlySet<string> = new Set(SUITS);

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && RANK_SET.has(value);
}

export function isSuit(value: unknown): value is Suit {
  return typeof value === 'string' && SUIT_SET.has(value);
}

/** Prüft, ob ein beliebiger Wert (z. B. aus JSON) eine gültige Karte ist. */
export function isCard(value: unknown): value is Card {
  return typeof value === 'string' && value.length === 2 && isRank(value[0]) && isSuit(value[1]);
}

/** Baut eine Karte aus Rang und Farbe. */
export function makeCard(rank: Rank, suit: Suit): Card {
  return `${rank}${suit}`;
}

/** Parst genau eine Karte in kanonischer Schreibweise (`"As"`, `"Td"`); wirft `CardParseError`. */
export function parseCard(text: string): Card {
  if (!isCard(text)) {
    throw new CardParseError(
      `Ungültige Karte: ${JSON.stringify(text)} (erwartet Rang 2–9/T/J/Q/K/A + Farbe c/d/h/s, z. B. "As")`,
    );
  }
  return text;
}

/** Parst durch Leerzeichen getrennte Karten (`"As Kd 7h"`); Duplikate sind ein Fehler. */
export function parseCards(text: string): Card[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  const cards = tokens.map(parseCard);
  const seen = new Set<Card>();
  for (const card of cards) {
    if (seen.has(card)) {
      throw new CardParseError(`Karte doppelt: ${card}`);
    }
    seen.add(card);
  }
  return cards;
}

/** Formatiert Karten als durch Leerzeichen getrennten String (Umkehrung von `parseCards`). */
export function formatCards(cards: readonly Card[]): string {
  return cards.join(' ');
}

export function cardRank(card: Card): Rank {
  return card[0] as Rank;
}

export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}

/** Numerischer Wert eines Rangs: 2 … 14 (Ass = 14). */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2;
}
