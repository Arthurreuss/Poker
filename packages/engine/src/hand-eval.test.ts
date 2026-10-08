import { describe, expect, it } from 'vitest';
import { parseCards, type Card } from './cards';
import {
  HAND_CATEGORIES,
  HAND_CATEGORY_NAMES,
  HandEvaluationError,
  compareHands,
  determineWinners,
  evaluateHand,
  handValue,
  type HandCategory,
} from './hand-eval';
import * as engine from './index';

const evalText = (text: string) => evaluateHand(parseCards(text));

interface Case {
  readonly name: string;
  readonly cards: string;
  readonly category: HandCategory;
  readonly best: string;
  readonly description: string;
}

describe('evaluateHand: Kategorien und Grenzfälle', () => {
  const cases: Case[] = [
    // Jede Kategorie (5 Karten)
    {
      name: 'Royal Flush',
      cards: 'As Ks Qs Js Ts',
      category: 'straight-flush',
      best: 'As Ks Qs Js Ts',
      description: 'Royal Flush',
    },
    {
      name: 'Straight Flush',
      cards: '9h Kh Qh Jh Th',
      category: 'straight-flush',
      best: 'Kh Qh Jh Th 9h',
      description: 'Straight Flush bis zum König',
    },
    {
      name: 'Vierling',
      cards: '7c 7d 7h 7s Kd',
      category: 'four-of-a-kind',
      best: '7c 7d 7h 7s Kd',
      description: 'Vierling, Siebenen, Kicker König',
    },
    {
      name: 'Full House',
      cards: 'Kc Kd Ks Th Tc',
      category: 'full-house',
      best: 'Kc Kd Ks Tc Th',
      description: 'Full House, Könige über Zehnen',
    },
    {
      name: 'Flush',
      cards: 'Ad 9d 6d 3d Qd',
      category: 'flush',
      best: 'Ad Qd 9d 6d 3d',
      description: 'Flush, Ass hoch',
    },
    {
      name: 'Straße',
      cards: '8c 9d Th Js Qc',
      category: 'straight',
      best: 'Qc Js Th 9d 8c',
      description: 'Straße bis zur Dame',
    },
    {
      name: 'Drilling',
      cards: '5c 5d 5h As 9c',
      category: 'three-of-a-kind',
      best: '5c 5d 5h As 9c',
      description: 'Drilling, Fünfen, Kicker Ass und Neun',
    },
    {
      name: 'Zwei Paare',
      cards: 'Ac Ad 8h 8s Qc',
      category: 'two-pair',
      best: 'Ac Ad 8h 8s Qc',
      description: 'Zwei Paare, Asse und Achten, Kicker Dame',
    },
    {
      name: 'Paar',
      cards: '9c 9d Ah Ks 7c',
      category: 'pair',
      best: '9c 9d Ah Ks 7c',
      description: 'Paar, Neunen, Kicker Ass, König und Sieben',
    },
    {
      name: 'High Card',
      cards: 'Ac Qd 9h 6s 3c',
      category: 'high-card',
      best: 'Ac Qd 9h 6s 3c',
      description: 'Höchste Karte Ass, Kicker Dame, Neun, Sechs und Drei',
    },
    // Wheel
    {
      name: 'Wheel (A-2-3-4-5)',
      cards: 'Ac 2d 3h 4s 5c',
      category: 'straight',
      best: '5c 4s 3h 2d Ac',
      description: 'Straße bis zur Fünf',
    },
    {
      name: 'Steel Wheel',
      cards: '2h 3h 4h 5h Ah Kd Kc',
      category: 'straight-flush',
      best: '5h 4h 3h 2h Ah',
      description: 'Straight Flush bis zur Fünf',
    },
    {
      name: 'Wheel + Sechs → Straße bis zur Sechs',
      cards: 'Ac 2d 3h 4s 5c 6d Kh',
      category: 'straight',
      best: '6d 5c 4s 3h 2d',
      description: 'Straße bis zur Sechs',
    },
    {
      name: 'kein Rundlauf (Q-K-A-2-3)',
      cards: 'Qc Kd Ah 2s 3c',
      category: 'high-card',
      best: 'Ah Kd Qc 3c 2s',
      description: 'Höchste Karte Ass, Kicker König, Dame, Drei und Zwei',
    },
    {
      name: 'Straße bis zum Buben',
      cards: '7c 8d 9h Ts Jc',
      category: 'straight',
      best: 'Jc Ts 9h 8d 7c',
      description: 'Straße bis zum Buben',
    },
    // 7-Karten-Grenzfälle
    {
      name: 'Flush schlägt Straße in denselben 7 Karten',
      cards: '4h 5h 6c 7h 8d 9h Kh',
      category: 'flush',
      best: 'Kh 9h 7h 5h 4h',
      description: 'Flush, König hoch',
    },
    {
      name: 'Flush mit 6 Karten einer Farbe → beste 5',
      cards: '2s 5s 9s Js Ks 3s Ad',
      category: 'flush',
      best: 'Ks Js 9s 5s 3s',
      description: 'Flush, König hoch',
    },
    {
      name: 'Flush mit 7 Karten einer Farbe → beste 5',
      cards: '2c 4c 6c 8c Tc Qc Ac',
      category: 'flush',
      best: 'Ac Qc Tc 8c 6c',
      description: 'Flush, Ass hoch',
    },
    {
      name: 'Straight Flush in 7 Karten mit höherer Straße in anderer Farbe',
      cards: '5d 6d 7d 8d 9d Tc 2h',
      category: 'straight-flush',
      best: '9d 8d 7d 6d 5d',
      description: 'Straight Flush bis zur Neun',
    },
    {
      name: 'Straße mit Paar',
      cards: '9c 9d Th Js Qc Kd 2h',
      category: 'straight',
      best: 'Kd Qc Js Th 9c',
      description: 'Straße bis zum König',
    },
    {
      name: 'Straße aus 6 aufeinanderfolgenden Rängen → höchste',
      cards: '3c 4d 5h 6s 7c 8d Kh',
      category: 'straight',
      best: '8d 7c 6s 5h 4d',
      description: 'Straße bis zur Acht',
    },
    {
      name: 'zwei Drillinge → Full House (höherer Drilling oben)',
      cards: '4c 4d 4h Jc Jd Js 2h',
      category: 'full-house',
      best: 'Jc Jd Js 4c 4d',
      description: 'Full House, Buben über Vieren',
    },
    {
      name: 'Drilling + zwei Paare → Full House mit höherem Paar',
      cards: '8c 8d 8h 3c 3d Qs Qh',
      category: 'full-house',
      best: '8c 8d 8h Qh Qs',
      description: 'Full House, Achten über Damen',
    },
    {
      name: 'drei Paare → beste zwei Paare, drittes Paar kann Kicker sein',
      cards: 'Ac Ad Kc Kd Qc Qd 2h',
      category: 'two-pair',
      best: 'Ac Ad Kc Kd Qc',
      description: 'Zwei Paare, Asse und Könige, Kicker Dame',
    },
    {
      name: 'drei Paare → Einzelkarte als Kicker, wenn höher',
      cards: '2c 2d 5c 5d 7c 7d Ah',
      category: 'two-pair',
      best: '7c 7d 5c 5d Ah',
      description: 'Zwei Paare, Siebenen und Fünfen, Kicker Ass',
    },
    {
      name: 'Vierling + Drilling → Kicker aus dem Drilling',
      cards: '9c 9d 9h 9s Kc Kd Kh',
      category: 'four-of-a-kind',
      best: '9c 9d 9h 9s Kc',
      description: 'Vierling, Neunen, Kicker König',
    },
    {
      name: 'Vierling + Paar + Einzelkarte → höchster Kicker',
      cards: '3c 3d 3h 3s 5c 5d Qh',
      category: 'four-of-a-kind',
      best: '3c 3d 3h 3s Qh',
      description: 'Vierling, Dreien, Kicker Dame',
    },
    {
      name: 'Paar in 7 Karten → drei beste Kicker',
      cards: '6c 6d 2h 9s Jc Kd 4h',
      category: 'pair',
      best: '6c 6d Kd Jc 9s',
      description: 'Paar, Sechsen, Kicker König, Bube und Neun',
    },
    {
      name: 'High Card in 7 Karten → fünf beste',
      cards: '2c 4d 7h 9s Jc Kd 3h',
      category: 'high-card',
      best: 'Kd Jc 9s 7h 4d',
      description: 'Höchste Karte König, Kicker Bube, Neun, Sieben und Vier',
    },
    {
      name: 'Royal Flush in 7 Karten',
      cards: 'Th Jh Qh Kh Ah 9h 2c',
      category: 'straight-flush',
      best: 'Ah Kh Qh Jh Th',
      description: 'Royal Flush',
    },
  ];

  it.each(cases)('$name', ({ cards, category, best, description }) => {
    const result = evalText(cards);
    expect(result.category).toBe(category);
    expect(result.cards).toEqual(parseCards(best));
    expect(result.description).toBe(description);
    expect(result.value).toBe(handValue(parseCards(cards)));
  });

  it('Ergebnis hängt nicht von der Reihenfolge der Karten ab (Wert, beste Karten, Beschreibung)', () => {
    for (const { cards } of cases) {
      const forward = parseCards(cards);
      const backward = [...forward].reverse();
      const a = evaluateHand(forward);
      const b = evaluateHand(backward);
      expect(b.value).toBe(a.value);
      expect(b.cards).toEqual(a.cards);
      expect(b.description).toBe(a.description);
    }
  });

  it('Kategorienamen sind vollständig', () => {
    expect(Object.keys(HAND_CATEGORY_NAMES).sort()).toEqual([...HAND_CATEGORIES].sort());
  });

  it('Ergebnis ist JSON-serialisierbar', () => {
    const result = evalText('Kc Kd Ks Th Tc 2d 3h');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe('Vergleich', () => {
  // [besser, schlechter] – jeweils 7 Karten bzw. 5
  const ordered: [string, string, string][] = [
    ['Straight Flush > Vierling', '5d 6d 7d 8d 9d', 'Ac Ad Ah As Kc'],
    ['Royal > Straight Flush bis König', 'As Ks Qs Js Ts', 'Kh Qh Jh Th 9h'],
    ['Straight Flush bis Sechs > Steel Wheel', '2h 3h 4h 5h 6h', 'Ah 2h 3h 4h 5h'],
    ['Vierling > Full House', '2c 2d 2h 2s 3c', 'Ac Ad Ah Kc Kd'],
    ['Vierling-Kicker entscheidet', '9c 9d 9h 9s Ac', '9c 9d 9h 9s Kc'],
    ['Full House: Drilling entscheidet', '3c 3d 3h 2c 2d', '2c 2d 2h Ac Ad'],
    ['Full House: Paar entscheidet bei gleichem Drilling', 'Kc Kd Kh Qc Qd', 'Kc Kd Kh Jc Jd'],
    ['Full House > Flush', '2c 2d 2h 3c 3d', 'Ah Kh Qh Jh 9h'],
    ['Flush > Straße', '2h 4h 6h 8h Th', 'Tc Jd Qh Ks Ac'],
    ['Flush: fünfte Karte entscheidet', 'Ah Kh Qh Jh 9h', 'As Ks Qs Js 8s'],
    ['Straße > Drilling', 'Ac 2d 3h 4s 5c', 'Ac Ad Ah Kc Qd'],
    ['Straße bis Sechs > Wheel', '2c 3d 4h 5s 6c', 'Ac 2d 3h 4s 5c'],
    ['Drilling > Zwei Paare', '2c 2d 2h 3c 4d', 'Ac Ad Kh Ks Qd'],
    ['Drilling: Kicker entscheidet', '7c 7d 7h Ac 3d', '7c 7d 7h Kc Qd'],
    ['Zwei Paare > Paar', '3c 3d 2h 2s 4d', 'Ac Ad Kh Qs Jd'],
    ['Zwei Paare: zweites Paar entscheidet', 'Ac Ad 9h 9s 2d', 'Ac Ad 8h 8s Kd'],
    ['Zwei Paare: Kicker entscheidet', 'Ac Ad 9h 9s 3d', 'Ac Ad 9h 9s 2d'],
    ['Paar > High Card', '2c 2d 3h 4s 5d', 'Ac Kd Qh Js 9d'],
    ['gleiches Paar: Kicker entscheidet', 'Kc Kd Ah 7s 2d', 'Kc Kd Qh Js Td'],
    ['gleiches Paar: dritter Kicker entscheidet', 'Kc Kd Ah 7s 3d', 'Kc Kd Ah 7s 2d'],
    ['High Card: letzte Karte entscheidet', 'Ac Kd Qh Js 9d', 'Ac Kd Qh Js 8d'],
  ];

  it.each(ordered)('%s', (_name, better, worse) => {
    const a = evalText(better);
    const b = evalText(worse);
    expect(compareHands(a, b)).toBe(1);
    expect(compareHands(b, a)).toBe(-1);
    expect(compareHands(a, a)).toBe(0);
  });

  it('gleiche Hand in anderen Farben ist gleich (Split)', () => {
    expect(compareHands(evalText('Ac Kd Qh Js 9d'), evalText('Ad Kh Qs Jc 9h'))).toBe(0);
    expect(compareHands(evalText('Ah Kh Qh Jh 9h'), evalText('As Ks Qs Js 9s'))).toBe(0);
  });
});

describe('determineWinners (7 Karten, Board + Hole Cards)', () => {
  const play = (board: string, players: Record<string, string>) =>
    determineWinners(
      Object.entries(players).map(([id, hole]) => ({ id, cards: [...parseCards(hole), ...parseCards(board)] })),
    );

  it('klarer Sieger', () => {
    const result = play('Ah Kd 7c 7s 2h', { anna: 'Ac Qd', ben: 'Kh Kc', cem: '9s 8s' });
    expect(result.winners).toEqual(['ben']);
    expect(result.winningHand.description).toBe('Full House, Könige über Siebenen');
    expect(result.hands.map((h) => h.id)).toEqual(['anna', 'ben', 'cem']);
  });

  it('Board spielt → alle teilen', () => {
    const result = play('Tc Jd Qh Ks As', { anna: '2c 3d', ben: '4h 5s', cem: '2h 2d' });
    expect(result.winners).toEqual(['anna', 'ben', 'cem']);
    expect(result.winningHand.description).toBe('Straße bis zum Ass');
  });

  it('gleiches Paar, Kicker entscheidet', () => {
    const result = play('Ac 9d 6h 4s 2c', { anna: 'Ad Kc', ben: 'Ah Qc' });
    expect(result.winners).toEqual(['anna']);
  });

  it('gleiches Paar, Kicker auf dem Board → Split', () => {
    const result = play('Ac Kd Qh 9s 8c', { anna: 'Ad 3c', ben: 'Ah 2c' });
    expect(result.winners).toEqual(['anna', 'ben']);
    expect(result.winningHand.description).toBe('Paar, Asse, Kicker König, Dame und Neun');
  });

  it('Zwei Paare auf dem Board, höherer Kicker gewinnt', () => {
    const result = play('Kc Kd 5h 5s 2c', { anna: 'Ac 3d', ben: 'Qh Jh' });
    expect(result.winners).toEqual(['anna']);
  });

  it('Split zwischen zwei von drei Spielern, Reihenfolge der Eingabe bleibt', () => {
    const result = play('2c 7d 9h Js Qc', { cem: 'Tc 8c', anna: '4d 3d', ben: 'Th 8h' });
    expect(result.winners).toEqual(['cem', 'ben']);
  });

  it('ein Teilnehmer gewinnt allein; leere Liste ist ein Fehler', () => {
    expect(play('2c 7d 9h Js Qc', { anna: '4d 3d' }).winners).toEqual(['anna']);
    expect(() => determineWinners([])).toThrow(HandEvaluationError);
  });
});

describe('ungültige Eingaben', () => {
  it.each([0, 1, 4, 8])('%i Karten → Fehler', (n) => {
    const cards = ['As', 'Kd', 'Qh', 'Js', 'Tc', '9d', '8h', '7s'].slice(0, n) as Card[];
    expect(() => evaluateHand(cards)).toThrow(HandEvaluationError);
    expect(() => handValue(cards)).toThrow(HandEvaluationError);
  });

  it('doppelte Karte → Fehler', () => {
    expect(() => evaluateHand(['As', 'Kd', 'Qh', 'Js', 'As'])).toThrow(/doppelt/);
    expect(() => evaluateHand(['As', 'Kd', 'Qh', 'Js', 'Tc', '2d', 'Kd'])).toThrow(HandEvaluationError);
  });

  it.each(['Xs', 'Ax', 'as', 'A', 'Asd', ''])('ungültige Karte %j → Fehler', (bad) => {
    const cards = ['Kd', 'Qh', 'Js', 'Tc', bad] as Card[];
    expect(() => evaluateHand(cards)).toThrow(HandEvaluationError);
  });

  it('Nicht-String aus JSON → Fehler', () => {
    const cards = ['Kd', 'Qh', 'Js', 'Tc', 42] as unknown as Card[];
    expect(() => evaluateHand(cards)).toThrow(HandEvaluationError);
  });
});

describe('öffentliche API', () => {
  it('exportiert die Handbewertung', () => {
    expect(engine.evaluateHand(parseCards('Ac 2d 3h 4s 5c')).description).toBe('Straße bis zur Fünf');
    expect(typeof engine.compareHands).toBe('function');
    expect(typeof engine.determineWinners).toBe('function');
  });
});
