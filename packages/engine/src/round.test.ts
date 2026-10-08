import { describe, expect, it } from 'vitest';
import { legalActions } from './betting';
import { DEFAULT_BLIND_LEVELS, DEFAULT_BLIND_STRUCTURE, type BlindStructure } from './blind-structure';
import { createDeck } from './deck';
import type { Card } from './cards';
import type { Action } from './hand-state';
import { createSeededRng, type Rng } from './rng';
import {
  applyRoundAction,
  roundBlindLevel,
  startNextHand,
  startRound,
  validateRoundConfig,
  type RoundConfig,
  type RoundErrorCode,
  type RoundSeat,
  type RoundState,
  type RoundUpdate,
} from './round';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const MIN = 60_000;
const fold: Action = { type: 'fold' };
const call: Action = { type: 'call' };
const allIn: Action = { type: 'allIn' };

const config = (overrides: Partial<RoundConfig> = {}): RoundConfig => ({
  startingStack: 1_000,
  blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
  turnTimeSeconds: 20,
  timeBankSeconds: 60,
  ...overrides,
});

const seats = (...ids: string[]): RoundSeat[] => ids.map((id, seat) => ({ id, seat }));

function ok(result: RoundUpdate): RoundState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.round;
}

function begin(cfg: RoundConfig, players: RoundSeat[], buttonSeat?: number): RoundState {
  return ok(startRound(cfg, players, createSeededRng(1), buttonSeat === undefined ? {} : { buttonSeat }));
}

/** Setzt Stacks (Summe sollte n × Startstack bleiben, damit die Szenarien realistisch sind). */
function withStacks(round: RoundState, stacks: Record<string, number>): RoundState {
  return { ...round, players: round.players.map((p) => ({ ...p, stack: stacks[p.id] ?? p.stack })) };
}

function act(round: RoundState, playerId: string, action: Action): RoundState {
  return ok(applyRoundAction(round, playerId, action));
}

function play(round: RoundState, steps: readonly [string, Action][]): RoundState {
  return steps.reduce((r, [id, a]) => act(r, id, a), round);
}

/**
 * Rng, das Fisher-Yates genau das gewünschte Deck erzeugen lässt (oben = Index 0).
 * `top` sind die obersten Karten, der Rest folgt in Standardreihenfolge.
 */
function riggedRng(top: readonly Card[]): Rng {
  const target = [...top, ...createDeck().filter((c) => !top.includes(c))];
  const work = createDeck();
  const picks: number[] = [];
  for (let i = work.length - 1; i > 0; i--) {
    const j = work.indexOf(target[i] as Card);
    picks.push(j);
    [work[i], work[j]] = [work[j] as Card, work[i] as Card];
  }
  let k = 0;
  return { int: () => picks[k++] ?? 0 };
}

/** Deck für eine Hand: Hole Cards in Austeil-Reihenfolge (ab links vom Button), dann Burn/Board. */
function riggedHand(holeCards: readonly [Card, Card][], board: readonly [Card, Card, Card, Card, Card]): Rng {
  const used = new Set<Card>([...holeCards.flat(), ...board]);
  const burns = createDeck().filter((c) => !used.has(c));
  const [f1, f2, f3, turn, river] = board;
  const top: Card[] = [
    ...holeCards.map((h) => h[0]),
    ...holeCards.map((h) => h[1]),
    burns[0] as Card,
    f1,
    f2,
    f3,
    burns[1] as Card,
    turn,
    burns[2] as Card,
    river,
  ];
  return riggedRng(top);
}

const DRY_BOARD: [Card, Card, Card, Card, Card] = ['Kd', 'Qc', 'Jh', '4s', '2d'];

function player(round: RoundState, id: string) {
  const p = round.players.find((x) => x.id === id);
  if (p === undefined) throw new Error(`kein Spieler ${id}`);
  return p;
}

function expectError(result: RoundUpdate, code: RoundErrorCode): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
  }
}

// ---------------------------------------------------------------------------
// Konfiguration und Start
// ---------------------------------------------------------------------------

describe('Rundenkonfiguration', () => {
  it('Standard-Blind-Struktur ist gültig, steigend alle 10 Minuten, Faktor 1,5–2 je Level', () => {
    expect(validateRoundConfig(config({ blindStructure: DEFAULT_BLIND_STRUCTURE }))).toBeNull();
    expect(DEFAULT_BLIND_STRUCTURE).toMatchObject({ type: 'increasing', levelMinutes: 10 });
    for (const [i, level] of DEFAULT_BLIND_LEVELS.entries()) {
      expect(level.bigBlind).toBe(level.smallBlind * 2);
      const prev = DEFAULT_BLIND_LEVELS[i - 1];
      if (prev !== undefined) {
        const factor = level.bigBlind / prev.bigBlind;
        expect(factor).toBeGreaterThanOrEqual(1.5);
        expect(factor).toBeLessThanOrEqual(2);
      }
    }
    // Startstack 1.500 bis 10.000: Level 1 tief genug, letztes Level über allen Chips von 9 × 10.000.
    expect(1_500 / (DEFAULT_BLIND_LEVELS[0]?.bigBlind ?? 0)).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_BLIND_LEVELS.at(-1)?.bigBlind).toBeGreaterThan(9 * 10_000);
  });

  const level = (smallBlind: number, bigBlind: number) => ({ smallBlind, bigBlind });
  it.each<[string, Partial<RoundConfig>]>([
    ['Startstack 0', { startingStack: 0 }],
    ['Startstack über 10⁸ (D-015)', { startingStack: 100_000_001 }],
    ['Startstack keine ganze Zahl', { startingStack: 1_000.5 }],
    ['Zeitlimit 0', { turnTimeSeconds: 0 }],
    ['Zeitbank negativ', { timeBankSeconds: -1 }],
    ['Small Blind 0', { blindStructure: { type: 'fixed', level: level(0, 20) } }],
    ['Small Blind = Big Blind', { blindStructure: { type: 'fixed', level: level(20, 20) } }],
    ['Small Blind > Big Blind', { blindStructure: { type: 'fixed', level: level(30, 20) } }],
    ['keine Level', { blindStructure: { type: 'increasing', levels: [], levelMinutes: 10 } }],
    ['Level-Dauer 0', { blindStructure: { type: 'increasing', levels: [level(10, 20)], levelMinutes: 0 } }],
    [
      'ungültiges Level',
      { blindStructure: { type: 'increasing', levels: [level(10, 20), level(40, 30)], levelMinutes: 5 } },
    ],
    ['unbekannter Typ', { blindStructure: { type: 'turbo' } as unknown as BlindStructure }],
    ['Ante im Level (D-016)', { blindStructure: { type: 'fixed', level: { ...level(10, 20), ante: 5 } as never } }],
  ])('abgelehnt: %s', (_label, overrides) => {
    const cfg = config(overrides);
    expect(validateRoundConfig(cfg)).toEqual(expect.any(String));
    expectError(startRound(cfg, seats('A', 'B'), createSeededRng(1)), 'INVALID_CONFIG');
  });

  it.each<[string, RoundSeat[]]>([
    ['nur ein Spieler', seats('A')],
    ['zehn Spieler (D-007)', seats('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J')],
    [
      'doppelte ID',
      [
        { id: 'A', seat: 0 },
        { id: 'A', seat: 1 },
      ],
    ],
    [
      'doppelter Sitz',
      [
        { id: 'A', seat: 0 },
        { id: 'B', seat: 0 },
      ],
    ],
    [
      'Sitz 9',
      [
        { id: 'A', seat: 0 },
        { id: 'B', seat: 9 },
      ],
    ],
    [
      'leere ID',
      [
        { id: '', seat: 0 },
        { id: 'B', seat: 1 },
      ],
    ],
  ])('Spieler abgelehnt: %s', (_label, players) => {
    expectError(startRound(config(), players, createSeededRng(1)), 'INVALID_PLAYERS');
  });

  it('Button auf leerem Sitz wird abgelehnt', () => {
    expectError(startRound(config(), seats('A', 'B'), createSeededRng(1), { buttonSeat: 5 }), 'INVALID_PLAYERS');
  });

  it('alle starten mit dem Startstack, erster Button zufällig (seeded) oder festgelegt', () => {
    const players = [
      { id: 'A', seat: 2 },
      { id: 'B', seat: 7 },
      { id: 'C', seat: 4 },
    ];
    const round = ok(startRound(config(), players, createSeededRng(3)));
    expect(round.phase).toBe('waiting');
    expect(round.players.map((p) => [p.id, p.seat, p.stack])).toEqual([
      ['A', 2, 1_000],
      ['C', 4, 1_000],
      ['B', 7, 1_000],
    ]);
    const buttons = new Set<number>();
    for (let seed = 0; seed < 50; seed++)
      buttons.add(ok(startRound(config(), players, createSeededRng(seed))).firstButtonSeat);
    expect([...buttons].sort()).toEqual([2, 4, 7]);
    expect(ok(startRound(config(), players, createSeededRng(3), { buttonSeat: 7 })).firstButtonSeat).toBe(7);
  });

  it('Zeitlimit und Zeitbank werden nur durchgereicht', () => {
    const round = begin(config({ turnTimeSeconds: 30, timeBankSeconds: 120 }), seats('A', 'B'));
    expect(round.config).toMatchObject({ turnTimeSeconds: 30, timeBankSeconds: 120 });
  });
});

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

describe('Ablauf einer Runde', () => {
  it('Zustandsfehler: keine Aktion ohne Hand, keine zweite Hand, ungültige Zeit; Eingabe bleibt unverändert', () => {
    const round = begin(config(), seats('A', 'B', 'C'), 0);
    expectError(applyRoundAction(round, 'A', fold), 'NO_HAND_IN_PROGRESS');
    expectError(startNextHand(round, -1, createSeededRng(1)), 'INVALID_TIME');
    expectError(startNextHand(round, 1.5, createSeededRng(1)), 'INVALID_TIME');
    const before = JSON.stringify(round);
    const running = ok(startNextHand(round, 0, createSeededRng(1)));
    expect(JSON.stringify(round)).toBe(before);
    expect(running.phase).toBe('hand');
    expect(running.handNumber).toBe(1);
    expectError(startNextHand(running, 0, createSeededRng(1)), 'HAND_IN_PROGRESS');
    // Fehler der Hand werden durchgereicht.
    expectError(applyRoundAction(running, 'B', fold), 'NOT_YOUR_TURN');
    const runningBefore = JSON.stringify(running);
    const done = play(running, [
      ['A', fold],
      ['B', fold],
    ]);
    expect(JSON.stringify(running)).toBe(runningBefore);
    expect(done.phase).toBe('waiting');
    expect(done.hand?.phase).toBe('complete');
    expect(done.players.map((p) => p.stack)).toEqual([1_000, 990, 1_010]);
  });

  it('erste Hand: Positionen aus dem festgelegten Button, Blinds des ersten Levels', () => {
    const round = ok(startNextHand(begin(config(), seats('A', 'B', 'C', 'D'), 2), 0, createSeededRng(1)));
    expect(round.positions).toEqual({ buttonSeat: 2, smallBlindPositionSeat: 3, smallBlindSeat: 3, bigBlindSeat: 0 });
    expect(round.hand).toMatchObject({
      buttonSeat: 2,
      smallBlindSeat: 3,
      bigBlindSeat: 0,
      smallBlind: 10,
      bigBlind: 20,
    });
    expect(round.hand?.ante).toBe(0);
  });

  it('Button wandert, ausgeschiedene Spieler sind nicht mehr in der Hand', () => {
    let round = withStacks(begin(config(), seats('A', 'B', 'C', 'D'), 0), { A: 1_000, B: 1_000, C: 0, D: 2_000 });
    round = { ...round, players: round.players.map((p) => (p.id === 'C' ? { ...p, placement: 4 } : p)) };
    round = ok(startNextHand(round, 0, createSeededRng(1)));
    // Erste Hand mit 3 Spielern auf Sitz 0, 1, 3: Button 0, SB 1, BB 3.
    expect(round.hand?.players.map((p) => p.id)).toEqual(['A', 'B', 'D']);
    expect(round.positions).toMatchObject({ buttonSeat: 0, smallBlindSeat: 1, bigBlindSeat: 3 });
  });
});

describe('Blind-Level', () => {
  const levels: BlindStructure = {
    type: 'increasing',
    levels: [
      { smallBlind: 10, bigBlind: 20 },
      { smallBlind: 20, bigBlind: 40 },
      { smallBlind: 50, bigBlind: 100 },
    ],
    levelMinutes: 10,
  };
  const t0 = 1_700_000_000_000;

  it('Level-Wechsel greift erst ab der nächsten Hand', () => {
    let round = begin(config({ blindStructure: levels }), seats('A', 'B', 'C'), 0);
    expect(roundBlindLevel(round, t0)).toEqual({ smallBlind: 10, bigBlind: 20, levelIndex: 0, nextLevelAtMs: null });

    round = ok(startNextHand(round, t0 + 9 * MIN, createSeededRng(1))); // Rundenstart = erste Hand
    expect(round.startedAtMs).toBe(t0 + 9 * MIN);
    expect(round.hand).toMatchObject({ smallBlind: 10, bigBlind: 20 });
    expect(roundBlindLevel(round, t0 + 9 * MIN)).toEqual({
      smallBlind: 10,
      bigBlind: 20,
      levelIndex: 0,
      nextLevelAtMs: t0 + 19 * MIN,
    });

    // Level läuft während der Hand ab: Die Hand bleibt bei 10/20 (Engine kennt keine Uhr).
    round = act(round, 'A', { type: 'raise', amount: 60 });
    expect(roundBlindLevel(round, t0 + 20 * MIN)).toMatchObject({ levelIndex: 1, bigBlind: 40 });
    round = play(round, [
      ['B', call],
      ['C', fold],
    ]);
    expect(round.hand?.bigBlind).toBe(20);
    while (round.phase === 'hand' && round.hand !== null) {
      const legal = legalActions(round.hand);
      if (legal === null) break;
      round = act(round, legal.playerId, { type: 'check' });
    }
    expect(round.phase).toBe('waiting');
    expect(round.hand?.bigBlind).toBe(20);

    // Nächste Hand: 10 Minuten nach Rundenstart → Level 2.
    round = ok(startNextHand(round, t0 + 19 * MIN, createSeededRng(2)));
    expect(round.levelIndex).toBe(1);
    expect(round.hand).toMatchObject({ smallBlind: 20, bigBlind: 40 });
  });

  it('kurz vor Level-Ende noch altes Level; nach dem letzten Level bleibt es beim letzten', () => {
    let round = ok(startNextHand(begin(config({ blindStructure: levels }), seats('A', 'B'), 0), 0, createSeededRng(1)));
    round = act(round, 'A', fold);
    round = ok(startNextHand(round, 10 * MIN - 1, createSeededRng(1)));
    expect(round.hand?.bigBlind).toBe(20);
    round = act(round, round.hand?.toActId ?? '', fold);
    round = ok(startNextHand(round, 500 * MIN, createSeededRng(1)));
    expect(round.levelIndex).toBe(2);
    expect(round.hand?.bigBlind).toBe(100);
    expect(roundBlindLevel(round, 600 * MIN)).toMatchObject({ levelIndex: 2, nextLevelAtMs: null });
    // Zeit springt zurück: Level wird nicht zurückgedreht.
    round = act(round, round.hand?.toActId ?? '', fold);
    round = ok(startNextHand(round, 5 * MIN, createSeededRng(1)));
    expect(round.hand?.bigBlind).toBe(100);
  });

  it('feste Blinds ändern sich nie', () => {
    let round = ok(startNextHand(begin(config(), seats('A', 'B'), 0), 0, createSeededRng(1)));
    round = act(round, 'A', fold);
    round = ok(startNextHand(round, 10_000 * MIN, createSeededRng(1)));
    expect(round.hand?.bigBlind).toBe(20);
    expect(roundBlindLevel(round, 10_000 * MIN)).toEqual({
      smallBlind: 10,
      bigBlind: 20,
      levelIndex: 0,
      nextLevelAtMs: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Ausscheiden, Platzierung, Punkte
// ---------------------------------------------------------------------------

describe('Platzierungen und Punkte', () => {
  /**
   * 4 Spieler, Button A (0), SB B (1), BB C (2), D (3) zuerst. B und C gehen All-in, A callt mit Assen
   * und gewinnt, D foldet. Austeil-Reihenfolge ab links vom Button: B, C, D, A.
   */
  function doubleBust(stacks: Record<string, number>): RoundState {
    const round = withStacks(begin(config(), seats('A', 'B', 'C', 'D'), 0), stacks);
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['9c', '5c'], // D
        ['Ah', 'As'], // A
      ],
      DRY_BOARD,
    );
    return play(ok(startNextHand(round, 0, rng)), [
      ['D', fold],
      ['A', allIn],
      ['B', allIn],
      ['C', allIn],
    ]);
  }

  it('gleichzeitiges Ausscheiden: größerer Stack zu Handbeginn = bessere Platzierung', () => {
    const round = doubleBust({ A: 1_700, B: 300, C: 500, D: 1_500 });
    expect(round.phase).toBe('waiting');
    expect(round.players.map((p) => [p.id, p.stack, p.placement, p.sharedPlacement, p.eliminatedInHand])).toEqual([
      ['A', 2_500, null, false, null],
      ['B', 0, 4, false, 1],
      ['C', 0, 3, false, 1],
      ['D', 1_500, null, false, null],
    ]);
  });

  it('gleicher Stack zu Handbeginn: geteilte Platzierung, Punkte gemittelt und abgerundet', () => {
    let round = doubleBust({ A: 1_700, B: 400, C: 400, D: 1_500 });
    expect(player(round, 'B')).toMatchObject({ placement: 3, sharedPlacement: true });
    expect(player(round, 'C')).toMatchObject({ placement: 3, sharedPlacement: true });

    // Heads-up A gegen D: A (Button/SB, Sitz 0) ... Hand 2: BB rückt von C (2) auf D (3), A ist Button/SB.
    const rng = riggedHand(
      [
        ['9h', '9d'], // D (links vom Button)
        ['Ad', 'Ac'], // A
      ],
      DRY_BOARD,
    );
    round = ok(startNextHand(round, 0, rng));
    expect(round.positions).toMatchObject({ buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 3 });
    round = play(round, [
      ['A', allIn],
      ['D', call],
    ]);
    expect(round.phase).toBe('finished');
    expect(round.standings).toEqual([
      { playerId: 'A', seat: 0, placement: 1, sharedPlacement: false, points: 4 },
      { playerId: 'D', seat: 3, placement: 2, sharedPlacement: false, points: 2 },
      { playerId: 'B', seat: 1, placement: 3, sharedPlacement: true, points: 0 },
      { playerId: 'C', seat: 2, placement: 3, sharedPlacement: true, points: 0 },
    ]);
    expect(player(round, 'A').stack).toBe(4_000);
    // Beendete Runde nimmt nichts mehr an.
    expectError(startNextHand(round, 0, createSeededRng(1)), 'ROUND_FINISHED');
    expectError(applyRoundAction(round, 'A', fold), 'ROUND_FINISHED');
  });

  it('letzte Hand mit zwei Ausgeschiedenen: Sieger Platz 1, dann nach Stack zu Handbeginn', () => {
    // 3 Spieler, Button A (0), SB B (1), BB C (2); A zuerst. Austeilen: B, C, A.
    const round = withStacks(begin(config(), seats('A', 'B', 'C'), 0), { A: 1_500, B: 800, C: 700 });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['Ah', 'As'], // A
      ],
      DRY_BOARD,
    );
    const done = play(ok(startNextHand(round, 0, rng)), [
      ['A', allIn],
      ['B', allIn],
      ['C', allIn],
    ]);
    expect(done.phase).toBe('finished');
    expect(done.standings).toEqual([
      { playerId: 'A', seat: 0, placement: 1, sharedPlacement: false, points: 3 },
      { playerId: 'B', seat: 1, placement: 2, sharedPlacement: false, points: 1 },
      { playerId: 'C', seat: 2, placement: 3, sharedPlacement: false, points: 0 },
    ]);
  });

  it('nicht gecallter Rest rettet einen Spieler: nur wer 0 Chips hat, scheidet aus', () => {
    const round = withStacks(begin(config(), seats('A', 'B', 'C'), 0), { A: 1_000, B: 1_200, C: 800 });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['Ah', 'As'], // A
      ],
      DRY_BOARD,
    );
    const done = play(ok(startNextHand(round, 0, rng)), [
      ['A', allIn],
      ['B', allIn],
      ['C', allIn],
    ]);
    // A gewinnt Main und Side Pot, B bekommt die nicht gecallten 200 zurück.
    expect(done.phase).toBe('waiting');
    expect(player(done, 'C')).toMatchObject({ stack: 0, placement: 3 });
    expect(player(done, 'B')).toMatchObject({ stack: 200, placement: null });
    expect(player(done, 'A')).toMatchObject({ stack: 2_800, placement: null });
  });

  it('Punkte ohne Gleichstand: n − k, Sieger +1 (9 Spieler, gespielte Runde)', () => {
    const round = playBotRound(createSeededRng(99), seats('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'));
    const standings = round.standings ?? [];
    expect(standings).toHaveLength(9);
    for (const s of standings) {
      if (!s.sharedPlacement) expect(s.points).toBe(9 - s.placement + (s.placement === 1 ? 1 : 0));
    }
  });
});

// ---------------------------------------------------------------------------
// Dead Button und Heads-up über die Rundenlogik
// ---------------------------------------------------------------------------

describe('Dead Button und Heads-up in der Runde', () => {
  it('Big Blind scheidet aus → nächste Hand ohne Small Blind, danach Dead Button', () => {
    // 5 Spieler, Button A (0), SB B (1), BB C (2). Austeilen: B, C, D, E, A. Preflop zuerst D.
    let round = withStacks(begin(config(), seats('A', 'B', 'C', 'D', 'E'), 0), {
      A: 1_225,
      B: 1_225,
      C: 100,
      D: 1_225,
      E: 1_225,
    });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['Ah', 'As'], // D
        ['9c', '5c'], // E
        ['6d', '4h'], // A
      ],
      DRY_BOARD,
    );
    round = play(ok(startNextHand(round, 0, rng)), [
      ['D', allIn],
      ['E', fold],
      ['A', fold],
      ['B', fold],
      ['C', call],
    ]);
    expect(player(round, 'C')).toMatchObject({ stack: 0, placement: 5 });

    // Hand 2: BB rückt genau einen Spieler weiter (D, Sitz 3); SB wäre C (leer) → kein Small Blind; Button B.
    round = ok(startNextHand(round, 0, createSeededRng(5)));
    expect(round.positions).toEqual({
      buttonSeat: 1,
      smallBlindPositionSeat: 2,
      smallBlindSeat: null,
      bigBlindSeat: 3,
    });
    const hand2 = round.hand;
    expect(hand2).toMatchObject({ buttonSeat: 1, smallBlindSeat: null, bigBlindSeat: 3 });
    expect(hand2?.log.map((e) => [e.type, e.playerId])).toEqual([['bigBlind', 'D']]);
    expect(hand2?.toActId).toBe('E');
    round = play(round, [
      ['E', fold],
      ['A', fold],
      ['B', fold],
    ]);

    // Hand 3: Dead Button auf dem leeren Sitz 2, SB D, BB E.
    round = ok(startNextHand(round, 0, createSeededRng(6)));
    expect(round.hand).toMatchObject({ buttonSeat: 2, smallBlindSeat: 3, bigBlindSeat: 4 });
    expect(round.hand?.toActId).toBe('A');
    round = play(round, [
      ['A', fold],
      ['B', fold],
      ['D', fold],
    ]);

    // Hand 4: wieder normal.
    round = ok(startNextHand(round, 0, createSeededRng(7)));
    expect(round.hand).toMatchObject({ buttonSeat: 3, smallBlindSeat: 4, bigBlindSeat: 0 });
  });

  it('Small Blind scheidet aus → nächste Hand mit Button auf seinem leeren Sitz', () => {
    // 4 Spieler, Button A (0), SB B (1), BB C (2), D zuerst. Austeilen: B, C, D, A.
    let round = withStacks(begin(config(), seats('A', 'B', 'C', 'D'), 0), { A: 1_300, B: 100, C: 1_300, D: 1_300 });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['Ah', 'As'], // D
        ['9c', '5c'], // A
      ],
      DRY_BOARD,
    );
    round = play(ok(startNextHand(round, 0, rng)), [
      ['D', { type: 'raise', amount: 200 }],
      ['A', fold],
      ['B', allIn],
      ['C', fold],
    ]);
    expect(player(round, 'B')).toMatchObject({ stack: 0, placement: 4 });
    round = ok(startNextHand(round, 0, createSeededRng(5)));
    expect(round.hand).toMatchObject({ buttonSeat: 1, smallBlindSeat: 2, bigBlindSeat: 3 });
    expect(round.hand?.players.map((p) => p.id)).toEqual(['A', 'C', 'D']);
  });

  it('Übergang 3 → 2: Button = Small Blind, voriger Big Blind zahlt nicht noch einmal', () => {
    // Button A (0), SB B (1), BB C (2); A zuerst. Austeilen: B, C, A. A schlägt C aus.
    let round = withStacks(begin(config(), seats('A', 'B', 'C'), 0), { A: 1_400, B: 1_400, C: 200 });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['8s', '3h'], // C
        ['Ah', 'As'], // A
      ],
      DRY_BOARD,
    );
    round = play(ok(startNextHand(round, 0, rng)), [
      ['A', allIn],
      ['B', fold],
      ['C', call],
    ]);
    expect(player(round, 'C')).toMatchObject({ stack: 0, placement: 3 });

    // Heads-up: BB rückt von C auf A, B ist Button und Small Blind und handelt preflop zuerst.
    round = ok(startNextHand(round, 0, createSeededRng(5)));
    expect(round.hand).toMatchObject({ buttonSeat: 1, smallBlindSeat: 1, bigBlindSeat: 0, toActId: 'B' });
    round = act(round, 'B', fold);
    round = ok(startNextHand(round, 0, createSeededRng(6)));
    expect(round.hand).toMatchObject({ buttonSeat: 0, smallBlindSeat: 0, bigBlindSeat: 1, toActId: 'A' });
  });

  it('Übergang 3 → 2, wenn der Big Blind überlebt: er wird Button/Small Blind', () => {
    // A (Button) scheidet aus. Austeilen: B, C, A. C (BB) gewinnt gegen A.
    let round = withStacks(begin(config(), seats('A', 'B', 'C'), 0), { A: 200, B: 1_400, C: 1_400 });
    const rng = riggedHand(
      [
        ['7h', '2c'], // B
        ['Ah', 'As'], // C
        ['8s', '3h'], // A
      ],
      DRY_BOARD,
    );
    round = play(ok(startNextHand(round, 0, rng)), [
      ['A', allIn],
      ['B', fold],
      ['C', call],
    ]);
    expect(player(round, 'A')).toMatchObject({ stack: 0, placement: 3 });
    round = ok(startNextHand(round, 0, createSeededRng(5)));
    expect(round.hand).toMatchObject({ buttonSeat: 2, smallBlindSeat: 2, bigBlindSeat: 1 });
  });
});

// ---------------------------------------------------------------------------
// Serialisierung
// ---------------------------------------------------------------------------

describe('JSON', () => {
  it('Rundenzustand übersteht JSON-Roundtrip an jeder Stelle und spielt identisch weiter', () => {
    const players = seats('A', 'B', 'C', 'D', 'E');
    const direct = playBotRound(createSeededRng(17), players);
    const viaJson = playBotRound(createSeededRng(17), players, (r) => JSON.parse(JSON.stringify(r)) as RoundState);
    expect(viaJson).toEqual(direct);
    expect(direct.phase).toBe('finished');
    expect(JSON.stringify(direct)).not.toContain('undefined');
  });
});

// ---------------------------------------------------------------------------
// Bot-Runde für mehrere Tests
// ---------------------------------------------------------------------------

/** Spielt eine ganze Runde mit Zufalls-Bots (Standardstruktur, 1.500 Startstack, 1 Minute pro Hand). */
function playBotRound(rng: Rng, players: RoundSeat[], transform: (r: RoundState) => RoundState = (r) => r): RoundState {
  let round = transform(
    ok(startRound(config({ startingStack: 1_500, blindStructure: DEFAULT_BLIND_STRUCTURE }), players, rng)),
  );
  let now = 0;
  for (let hands = 0; round.phase !== 'finished'; hands++) {
    if (hands > 2_000) throw new Error('Runde endet nicht');
    round = transform(ok(startNextHand(round, now, rng)));
    now += MIN;
    while (round.phase === 'hand' && round.hand !== null) {
      const legal = legalActions(round.hand);
      if (legal === null) throw new Error('niemand am Zug');
      const choice = legal.actions[rng.int(legal.actions.length)];
      if (choice === undefined) throw new Error('keine Aktion');
      const action: Action =
        choice.type === 'bet' || choice.type === 'raise'
          ? { type: choice.type, amount: choice.min }
          : { type: choice.type };
      round = transform(ok(applyRoundAction(round, legal.playerId, action)));
    }
  }
  return round;
}
