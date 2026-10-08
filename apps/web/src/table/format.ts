import type { Suit } from '@poker/engine';
import type { Card } from './types';

const grouped = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/**
 * Chip-Beträge kurz und gut lesbar: bis 99.999 voll mit Tausenderpunkt,
 * darüber kompakt (`125,5k`, `1,2M`), damit Plaketten nicht überlaufen.
 */
export function formatChips(amount: number): string {
  if (amount < 100_000) {
    return grouped.format(amount);
  }
  if (amount < 1_000_000) {
    return `${compact.format(amount / 1000)}k`;
  }
  return `${compact.format(amount / 1_000_000)}M`;
}

const RANK_LABELS: Record<string, string> = { T: '10' };
const RANK_NAMES: Record<string, string> = {
  A: 'Ass',
  K: 'König',
  Q: 'Dame',
  J: 'Bube',
  T: 'Zehn',
};
const SUIT_NAMES: Record<string, string> = { c: 'Kreuz', d: 'Karo', h: 'Herz', s: 'Pik' };

/** Farbe einer Karte (nur Typ-Import aus der Engine, kein Laufzeitcode). */
export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}

/** Rang, wie er auf der Karte steht (`T` → `10`). */
export function rankLabel(card: Card): string {
  const rank = card[0] ?? '';
  return RANK_LABELS[rank] ?? rank;
}

/** Barrierefreier Name, z. B. „Pik Ass“, „Herz 10“. */
export function cardName(card: Card): string {
  const rank = card[0] ?? '';
  const suit = card[1] ?? '';
  return `${SUIT_NAMES[suit] ?? suit} ${RANK_NAMES[rank] ?? rankLabel(card)}`;
}
