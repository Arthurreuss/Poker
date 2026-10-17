/**
 * Inhalt der Hand-Übersicht (WP-038): alle Pokerhände von der besten zur schwächsten, mit Erklärung
 * und Beispielkarten. Namen und Rangfolge kommen aus der Engine (`HAND_CATEGORIES`,
 * `HAND_CATEGORY_NAMES`); der Royal Flush ist dort keine eigene Kategorie, sondern der höchste
 * Straight Flush, und wird hier nur als eigene Zeile gezeigt. Tests prüfen jede Beispielhand mit
 * `evaluateHand` gegen die angegebene Kategorie.
 */
import { HAND_CATEGORIES, HAND_CATEGORY_NAMES, type HandCategory } from '@poker/engine';
import type { Card } from '../types';

export interface HandRankingEntry {
  /** Eindeutiger Schlüssel der Zeile (`royal-flush` zusätzlich zu den Engine-Kategorien). */
  readonly id: HandCategory | 'royal-flush';
  /** Engine-Kategorie, zu der die Beispielhand gehört. */
  readonly category: HandCategory;
  readonly name: string;
  readonly description: string;
  /** Fünf Beispielkarten; die bildenden Karten zuerst. */
  readonly cards: readonly Card[];
  /** Wie viele der Karten die Hand bilden; der Rest sind Beikarten (Kicker) und wird abgedunkelt. */
  readonly formingCount: number;
}

type Example = Omit<HandRankingEntry, 'id' | 'category' | 'name'>;

/** Erklärung und Beispiel je Engine-Kategorie. */
const EXAMPLES: Readonly<Record<HandCategory, Example>> = {
  'straight-flush': {
    description: 'Fünf Karten in Folge, alle in derselben Farbe.',
    cards: ['9h', '8h', '7h', '6h', '5h'],
    formingCount: 5,
  },
  'four-of-a-kind': {
    description: 'Vier Karten mit demselben Rang.',
    cards: ['Qc', 'Qd', 'Qh', 'Qs', '7d'],
    formingCount: 4,
  },
  'full-house': {
    description: 'Ein Drilling und ein Paar zusammen.',
    cards: ['Kh', 'Kd', 'Ks', '9c', '9h'],
    formingCount: 5,
  },
  flush: {
    description: 'Fünf Karten derselben Farbe, nicht in Folge.',
    cards: ['Ad', 'Jd', '8d', '5d', '3d'],
    formingCount: 5,
  },
  straight: {
    description: 'Fünf Karten in Folge, Farben gemischt. Das Ass zählt auch als Eins (5-4-3-2-A).',
    cards: ['Tc', '9d', '8h', '7s', '6c'],
    formingCount: 5,
  },
  'three-of-a-kind': {
    description: 'Drei Karten mit demselben Rang.',
    cards: ['7s', '7h', '7d', 'Kc', '2s'],
    formingCount: 3,
  },
  'two-pair': {
    description: 'Zwei Paare mit verschiedenen Rängen.',
    cards: ['Jh', 'Js', '4c', '4d', 'As'],
    formingCount: 4,
  },
  pair: {
    description: 'Zwei Karten mit demselben Rang.',
    cards: ['Ac', 'Ah', 'Ks', '9d', '5c'],
    formingCount: 2,
  },
  'high-card': {
    description: 'Keine der Hände oben: Es zählt die höchste Karte.',
    cards: ['Ah', 'Jd', '9c', '6s', '3h'],
    formingCount: 1,
  },
};

const ROYAL_FLUSH: HandRankingEntry = {
  id: 'royal-flush',
  category: 'straight-flush',
  name: 'Royal Flush',
  description: 'Ass, König, Dame, Bube und Zehn in einer Farbe – der höchste Straight Flush.',
  cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'],
  formingCount: 5,
};

/** Alle Zeilen der Übersicht, beste Hand zuerst (Engine-Reihenfolge umgekehrt, Royal Flush oben). */
export const HAND_RANKINGS: readonly HandRankingEntry[] = [
  ROYAL_FLUSH,
  ...[...HAND_CATEGORIES].reverse().map((category): HandRankingEntry => ({
    id: category,
    category,
    name: HAND_CATEGORY_NAMES[category],
    ...EXAMPLES[category],
  })),
];
