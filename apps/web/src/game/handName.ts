// Kurzname der eigenen besten Hand (WP-037), z. B. „Paar Könige“, „Straße“. Ab dem Flop über die
// Handbewertung der Engine (`evaluateHand`, 5–7 Karten); preflop (nur zwei Karten, das kann die Engine
// nicht) eigene kleine Ableitung: Paar oder höchste Karte. Kategorienamen aus `HAND_CATEGORY_NAMES`.
import { evaluateHand, HAND_CATEGORY_NAMES, type Card } from '@poker/engine';
import type { HeroHandView } from '../table/types';

const RANK_ORDER = '23456789TJQKA';
const NAME: Record<string, string> = {
  '2': 'Zwei',
  '3': 'Drei',
  '4': 'Vier',
  '5': 'Fünf',
  '6': 'Sechs',
  '7': 'Sieben',
  '8': 'Acht',
  '9': 'Neun',
  T: 'Zehn',
  J: 'Bube',
  Q: 'Dame',
  K: 'König',
  A: 'Ass',
};
const PLURAL: Record<string, string> = {
  '2': 'Zweien',
  '3': 'Dreien',
  '4': 'Vieren',
  '5': 'Fünfen',
  '6': 'Sechsen',
  '7': 'Siebenen',
  '8': 'Achten',
  '9': 'Neunen',
  T: 'Zehnen',
  J: 'Buben',
  Q: 'Damen',
  K: 'Könige',
  A: 'Asse',
};

const rank = (card: Card | undefined): string => card?.[0] ?? '';

/** Beste Hand aus zwei eigenen Karten und 0–5 Board-Karten. */
export function heroHandName(hole: readonly [Card, Card], board: readonly Card[]): HeroHandView {
  if (board.length < 3) {
    const [a, b] = hole.map(rank);
    const high = RANK_ORDER.indexOf(a ?? '') >= RANK_ORDER.indexOf(b ?? '') ? a : b;
    const short =
      a === b
        ? `${HAND_CATEGORY_NAMES.pair} ${PLURAL[a ?? ''] ?? ''}`
        : `${HAND_CATEGORY_NAMES['high-card']} ${NAME[high ?? ''] ?? ''}`;
    return { short, long: short };
  }
  const result = evaluateHand([...hole, ...board]);
  const top = rank(result.cards[0]);
  const category = HAND_CATEGORY_NAMES[result.category];
  let short: string;
  switch (result.category) {
    case 'high-card':
      short = `${category} ${NAME[top] ?? ''}`;
      break;
    case 'pair':
    case 'three-of-a-kind':
    case 'four-of-a-kind':
      short = `${category} ${PLURAL[top] ?? ''}`;
      break;
    case 'straight-flush':
      short = top === 'A' ? 'Royal Flush' : category;
      break;
    default:
      // Zwei Paare, Straße, Flush, Full House: Kategorie reicht am Platz, Details stehen in `long`.
      short = category;
  }
  return { short, long: result.description };
}
