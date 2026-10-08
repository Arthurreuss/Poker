/**
 * Handbewertung für Texas Hold'em (D-004: eigene Implementierung).
 * Algorithmus und Wertkodierung: ARCHITECTURE.md, Abschnitt „Engine: Handbewertung“.
 */
import { RANKS, type Card } from './cards';

/** Handkategorien aufsteigend nach Stärke; der Index ist die Kategorie-Nummer in `HandResult.value`. */
export const HAND_CATEGORIES = [
  'high-card',
  'pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
] as const;

export type HandCategory = (typeof HAND_CATEGORIES)[number];

/** Deutsche Anzeigenamen der Kategorien. */
export const HAND_CATEGORY_NAMES: Readonly<Record<HandCategory, string>> = {
  'high-card': 'Höchste Karte',
  pair: 'Paar',
  'two-pair': 'Zwei Paare',
  'three-of-a-kind': 'Drilling',
  straight: 'Straße',
  flush: 'Flush',
  'full-house': 'Full House',
  'four-of-a-kind': 'Vierling',
  'straight-flush': 'Straight Flush',
};

export interface HandResult {
  readonly category: HandCategory;
  /** Direkt vergleichbarer Wert: höher = besser, gleich = Split. */
  readonly value: number;
  /** Die fünf besten Karten, nach Bedeutung sortiert (z. B. Drilling, dann Paar; Wheel: 5-4-3-2-A). */
  readonly cards: readonly Card[];
  /** Deutsche Beschreibung für die Anzeige, z. B. „Full House, Könige über Zehnen“. */
  readonly description: string;
}

export class HandEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandEvaluationError';
  }
}

// Kategorie-Nummern (Index in HAND_CATEGORIES).
const HIGH_CARD = 0;
const PAIR = 1;
const TWO_PAIR = 2;
const TRIPS = 3;
const STRAIGHT = 4;
const FLUSH = 5;
const FULL_HOUSE = 6;
const QUADS = 7;
const STRAIGHT_FLUSH = 8;

const ACE = 14;
const ACE_LOW_BIT = 1 << 1;

// Lookup Zeichencode → Rangwert (2–14, 0 = ungültig) bzw. Farbindex (0–3, -1 = ungültig).
const RANK_BY_CODE = new Int8Array(128);
RANKS.forEach((rank, i) => {
  RANK_BY_CODE[rank.charCodeAt(0)] = i + 2;
});
const SUIT_BY_CODE = new Int8Array(128).fill(-1);
['c', 'd', 'h', 's'].forEach((suit, i) => {
  SUIT_BY_CODE[suit.charCodeAt(0)] = i;
});

function rankOf(card: Card): number {
  return RANK_BY_CODE[card.charCodeAt(0)] ?? 0;
}

function suitOf(card: Card): number {
  return SUIT_BY_CODE[card.charCodeAt(1)] ?? -1;
}

/** Kodiert Kategorie + bis zu fünf Tiebreak-Ränge (je 4 Bit, linksbündig) in eine Zahl < 2^24. */
function encode(category: number, r1: number, r2 = 0, r3 = 0, r4 = 0, r5 = 0): number {
  return (category << 20) | (r1 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4) | r5;
}

/** i-ter Tiebreak-Rang (0–4) aus einem kodierten Wert. */
function tiebreak(value: number, i: number): number {
  return (value >> (16 - 4 * i)) & 0xf;
}

/** Höchste Karte einer Straße in der Rang-Bitmaske (Bit r = Rang r), 0 wenn keine. Ass zählt auch als 1. */
function straightHigh(mask: number): number {
  const m = mask & (1 << ACE) ? mask | ACE_LOW_BIT : mask;
  for (let high = ACE; high >= 5; high--) {
    const run = 0x1f << (high - 4);
    if ((m & run) === run) return high;
  }
  return 0;
}

/** Die `n` höchsten Ränge einer Rang-Bitmaske, absteigend. */
function topRanks(mask: number, n: number): number[] {
  const out: number[] = [];
  for (let r = ACE; r >= 2 && out.length < n; r--) {
    if (mask & (1 << r)) out.push(r);
  }
  return out;
}

interface Core {
  readonly value: number;
  /** Farbindex des Flushs (nur bei Flush/Straight Flush relevant), sonst -1. */
  readonly flushSuit: number;
}

function evaluateCore(cards: readonly Card[]): Core {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new HandEvaluationError(`Handbewertung braucht 5–7 Karten, bekommen: ${String(n)}`);
  }
  // Rang-Bitmaske je Farbe.
  let m0 = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < n; i++) {
    // Laufzeitprüfung, weil Karten z. B. aus Client-JSON stammen können.
    const card: unknown = cards[i];
    if (typeof card !== 'string' || card.length !== 2) {
      throw new HandEvaluationError(`Ungültige Karte: ${JSON.stringify(card)}`);
    }
    const rank = rankOf(card as Card);
    const suit = rank === 0 ? -1 : suitOf(card as Card);
    if (suit < 0) {
      throw new HandEvaluationError(`Ungültige Karte: ${JSON.stringify(card)}`);
    }
    const bit = 1 << rank;
    const before = m0 + m1 + m2 + m3;
    if (suit === 0) m0 |= bit;
    else if (suit === 1) m1 |= bit;
    else if (suit === 2) m2 |= bit;
    else m3 |= bit;
    if (m0 + m1 + m2 + m3 === before) {
      throw new HandEvaluationError(`Karte doppelt: ${card}`);
    }
  }

  // Flush-Farbe (bei ≤ 7 Karten höchstens eine).
  let flushSuit = -1;
  let flushMask = 0;
  const suitMasks = [m0, m1, m2, m3];
  for (let s = 0; s < 4; s++) {
    const mask = suitMasks[s] ?? 0;
    if (popcount(mask) >= 5) {
      flushSuit = s;
      flushMask = mask;
    }
  }

  if (flushSuit >= 0) {
    const high = straightHigh(flushMask);
    if (high) return { value: encode(STRAIGHT_FLUSH, high), flushSuit };
  }

  // Ränge nach Häufigkeit gruppieren, jeweils absteigend.
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = ACE; r >= 2; r--) {
    const count = ((m0 >> r) & 1) + ((m1 >> r) & 1) + ((m2 >> r) & 1) + ((m3 >> r) & 1);
    if (count === 1) singles.push(r);
    else if (count === 2) pairs.push(r);
    else if (count === 3) trips.push(r);
    else if (count === 4) quads.push(r);
  }

  const [q] = quads;
  if (q !== undefined) {
    const kicker = Math.max(trips[0] ?? 0, pairs[0] ?? 0, singles[0] ?? 0);
    return { value: encode(QUADS, q, kicker), flushSuit };
  }

  const [t1, t2] = trips;
  if (t1 !== undefined && (t2 !== undefined || pairs.length > 0)) {
    return { value: encode(FULL_HOUSE, t1, Math.max(t2 ?? 0, pairs[0] ?? 0)), flushSuit };
  }

  if (flushSuit >= 0) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0] = topRanks(flushMask, 5);
    return { value: encode(FLUSH, a, b, c, d, e), flushSuit };
  }

  const high = straightHigh(m0 | m1 | m2 | m3);
  if (high) return { value: encode(STRAIGHT, high), flushSuit };

  const [s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0] = singles;
  if (t1 !== undefined) {
    return { value: encode(TRIPS, t1, s1, s2), flushSuit };
  }

  const [p1, p2, p3 = 0] = pairs;
  if (p1 !== undefined && p2 !== undefined) {
    return { value: encode(TWO_PAIR, p1, p2, Math.max(p3, s1)), flushSuit };
  }
  if (p1 !== undefined) {
    return { value: encode(PAIR, p1, s1, s2, s3), flushSuit };
  }
  return { value: encode(HIGH_CARD, s1, s2, s3, s4, s5), flushSuit };
}

function popcount(x: number): number {
  let v = x - ((x >> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
  return (((v + (v >> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Nur der vergleichbare Wert (ohne Beste-Karten und Beschreibung) – für Simulationen. */
export function handValue(cards: readonly Card[]): number {
  return evaluateCore(cards).value;
}

/** Bewertet 5–7 Karten und findet die beste 5-Karten-Hand. Wirft `HandEvaluationError` bei ungültiger Eingabe. */
export function evaluateHand(cards: readonly Card[]): HandResult {
  const { value, flushSuit } = evaluateCore(cards);
  const categoryIndex = value >> 20;
  const category = HAND_CATEGORIES[categoryIndex] ?? 'high-card';
  return {
    category,
    value,
    cards: bestCards(cards, categoryIndex, value, flushSuit),
    description: describe(categoryIndex, value),
  };
}

/** Vergleich zweier Ergebnisse: > 0 wenn `a` besser, < 0 wenn `b` besser, 0 bei Gleichstand (Split). */
export function compareHands(a: HandResult, b: HandResult): number {
  return Math.sign(a.value - b.value);
}

export interface ShowdownEntry<Id> {
  readonly id: Id;
  /** 5–7 Karten, typischerweise zwei Hole Cards + Board. */
  readonly cards: readonly Card[];
}

export interface ShowdownWinners<Id> {
  /** Alle Gewinner (mehrere = Split) in der Reihenfolge der Eingabe. */
  readonly winners: Id[];
  /** Die Gewinnerhand (bei Split identischer Wert). */
  readonly winningHand: HandResult;
  /** Bewertung jedes Teilnehmers in der Reihenfolge der Eingabe. */
  readonly hands: { readonly id: Id; readonly hand: HandResult }[];
}

/** Bestimmt aus mehreren Teilnehmern den oder die Gewinner (inkl. Split). */
export function determineWinners<Id>(entries: readonly ShowdownEntry<Id>[]): ShowdownWinners<Id> {
  const hands = entries.map((entry) => ({ id: entry.id, hand: evaluateHand(entry.cards) }));
  let best: HandResult | undefined;
  for (const { hand } of hands) {
    if (best === undefined || hand.value > best.value) best = hand;
  }
  if (best === undefined) {
    throw new HandEvaluationError('determineWinners braucht mindestens einen Teilnehmer');
  }
  const bestValue = best.value;
  return {
    winners: hands.filter(({ hand }) => hand.value === bestValue).map(({ id }) => id),
    winningHand: best,
    hands,
  };
}

// --- Beste fünf Karten ---

function bestCards(cards: readonly Card[], category: number, value: number, flushSuit: number): Card[] {
  const out: Card[] = [];
  // Gleiche Ränge in fester Farbreihenfolge (c, d, h, s) → Ergebnis unabhängig von der Eingabereihenfolge.
  const take = (rank: number, count: number, onlySuit: number): void => {
    const wanted = rank === 1 ? ACE : rank;
    let taken = 0;
    for (let suit = 0; suit < 4 && taken < count; suit++) {
      if (onlySuit >= 0 && suit !== onlySuit) continue;
      const card = cards.find((c) => rankOf(c) === wanted && suitOf(c) === suit);
      if (card !== undefined) {
        out.push(card);
        taken++;
      }
    }
  };
  const r = (i: number): number => tiebreak(value, i);

  switch (category) {
    case STRAIGHT_FLUSH:
    case STRAIGHT: {
      const suit = category === STRAIGHT_FLUSH ? flushSuit : -1;
      for (let rank = r(0); rank > r(0) - 5; rank--) take(rank, 1, suit);
      break;
    }
    case FLUSH:
      for (let i = 0; i < 5; i++) take(r(i), 1, flushSuit);
      break;
    case QUADS:
      take(r(0), 4, -1);
      take(r(1), 1, -1);
      break;
    case FULL_HOUSE:
      take(r(0), 3, -1);
      take(r(1), 2, -1);
      break;
    case TRIPS:
      take(r(0), 3, -1);
      take(r(1), 1, -1);
      take(r(2), 1, -1);
      break;
    case TWO_PAIR:
      take(r(0), 2, -1);
      take(r(1), 2, -1);
      take(r(2), 1, -1);
      break;
    case PAIR:
      take(r(0), 2, -1);
      for (let i = 1; i < 4; i++) take(r(i), 1, -1);
      break;
    default:
      for (let i = 0; i < 5; i++) take(r(i), 1, -1);
  }
  return out;
}

// --- Deutsche Beschreibung ---

// Index = Rangwert (2–14).
const NAME = [
  '',
  '',
  'Zwei',
  'Drei',
  'Vier',
  'Fünf',
  'Sechs',
  'Sieben',
  'Acht',
  'Neun',
  'Zehn',
  'Bube',
  'Dame',
  'König',
  'Ass',
];
const PLURAL = [
  '',
  '',
  'Zweien',
  'Dreien',
  'Vieren',
  'Fünfen',
  'Sechsen',
  'Siebenen',
  'Achten',
  'Neunen',
  'Zehnen',
  'Buben',
  'Damen',
  'Könige',
  'Asse',
];
/** „bis zur Fünf“, „bis zum Buben“ – Dativ mit Artikel, für Straßen (höchste Karte 5–14). */
const UP_TO = [
  '',
  '',
  '',
  '',
  '',
  'zur Fünf',
  'zur Sechs',
  'zur Sieben',
  'zur Acht',
  'zur Neun',
  'zur Zehn',
  'zum Buben',
  'zur Dame',
  'zum König',
  'zum Ass',
];

const name = (rank: number): string => NAME[rank] ?? '';
const plural = (rank: number): string => PLURAL[rank] ?? '';

/** „Ass“, „Ass und König“, „Ass, König und Sieben“. */
function list(ranks: readonly number[]): string {
  const names = ranks.map(name);
  const last = names.pop() ?? '';
  return names.length > 0 ? `${names.join(', ')} und ${last}` : last;
}

function describe(category: number, value: number): string {
  const r = (i: number): number => tiebreak(value, i);
  const kickers = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = from; i < to; i++) out.push(r(i));
    return out;
  };
  switch (category) {
    case STRAIGHT_FLUSH:
      return r(0) === ACE ? 'Royal Flush' : `Straight Flush bis ${UP_TO[r(0)] ?? ''}`;
    case QUADS:
      return `Vierling, ${plural(r(0))}, Kicker ${name(r(1))}`;
    case FULL_HOUSE:
      return `Full House, ${plural(r(0))} über ${plural(r(1))}`;
    case FLUSH:
      return `Flush, ${name(r(0))} hoch`;
    case STRAIGHT:
      return `Straße bis ${UP_TO[r(0)] ?? ''}`;
    case TRIPS:
      return `Drilling, ${plural(r(0))}, Kicker ${list(kickers(1, 3))}`;
    case TWO_PAIR:
      return `Zwei Paare, ${plural(r(0))} und ${plural(r(1))}, Kicker ${name(r(2))}`;
    case PAIR:
      return `Paar, ${plural(r(0))}, Kicker ${list(kickers(1, 4))}`;
    default:
      return `Höchste Karte ${name(r(0))}, Kicker ${list(kickers(1, 5))}`;
  }
}
