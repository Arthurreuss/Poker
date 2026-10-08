// Statistik-Definitionen (WP-019) als Tabellentests auf bekannten Hand-Historien.
import { describe, expect, it } from 'vitest';
import type { HandActionType, Street } from '../db/types';
import type { HandRecord, StoredAction } from '../history/records';
import { aggregateHandStats, classifyHand, playerHandFromRecord, type HandFlags, type PlayerHand } from './stats';

/** Kurzschreibweise: "p:call" = Preflop-Call, "f:fold*" = automatischer Fold am Flop. */
const STREETS: Record<string, Street> = { p: 'preflop', f: 'flop', t: 'turn', r: 'river' };
const ACTIONS: Record<string, HandActionType> = {
  sb: 'small_blind',
  bb: 'big_blind',
  fold: 'fold',
  check: 'check',
  call: 'call',
  bet: 'bet',
  raise: 'raise',
};

function hand(spec: string, opts: Partial<Omit<PlayerHand, 'actions'>> = {}): PlayerHand {
  const actions = spec
    .split(' ')
    .filter((s) => s !== '')
    .map((s) => {
      const [street = '', raw = ''] = s.split(':');
      const isAutomatic = raw.endsWith('*');
      const action = ACTIONS[raw.replace('*', '')];
      const st = STREETS[street];
      if (action === undefined || st === undefined) throw new Error(`Unbekannt: ${s}`);
      return { street: st, action, isAutomatic };
    });
  return { actions, boardSize: 0, showdown: false, wonPot: false, ...opts };
}

const NONE: HandFlags = {
  absent: false,
  preflopDecision: false,
  vpip: false,
  pfr: false,
  sawFlop: false,
  wentToShowdown: false,
  wonAtShowdown: false,
};

describe('classifyHand', () => {
  const cases: [string, PlayerHand, Partial<HandFlags>][] = [
    ['Fold preflop', hand('p:fold'), { preflopDecision: true }],
    [
      'Open-Limp (Call), Flop gesehen, dann Fold',
      hand('p:call f:fold', { boardSize: 3 }),
      {
        preflopDecision: true,
        vpip: true,
        sawFlop: true,
      },
    ],
    ['Raise preflop, alle folden', hand('p:raise'), { preflopDecision: true, vpip: true, pfr: true }],
    [
      'Small Blind completet (Call) = freiwillig',
      hand('p:sb p:call f:check', { boardSize: 3 }),
      {
        preflopDecision: true,
        vpip: true,
        sawFlop: true,
      },
    ],
    [
      'Big Blind checkt seine Option: nicht freiwillig, sieht aber den Flop',
      hand('p:bb p:check f:check t:fold', {
        boardSize: 4,
      }),
      { preflopDecision: true, sawFlop: true },
    ],
    ['Big Blind bekommt einen Walk: keine Entscheidung', hand('p:bb'), {}],
    [
      'All-in schon durch den Blind: keine Entscheidung, aber Showdown gewonnen',
      hand('p:bb', {
        boardSize: 5,
        showdown: true,
        wonPot: true,
      }),
      { sawFlop: true, wentToShowdown: true, wonAtShowdown: true },
    ],
    ['3-Bet nach Call: VPIP und PFR', hand('p:call p:raise'), { preflopDecision: true, vpip: true, pfr: true }],
    [
      'Call preflop, Showdown verloren',
      hand('p:call f:check t:call r:call', { boardSize: 5, showdown: true }),
      {
        preflopDecision: true,
        vpip: true,
        sawFlop: true,
        wentToShowdown: true,
      },
    ],
    [
      'Showdown, Pot geteilt = gewonnen',
      hand('p:raise f:bet t:check r:check', {
        boardSize: 5,
        showdown: true,
        wonPot: true,
      }),
      { preflopDecision: true, vpip: true, pfr: true, sawFlop: true, wentToShowdown: true, wonAtShowdown: true },
    ],
    [
      'Fold am River, andere gehen zum Showdown',
      hand('p:call f:check t:check r:fold', {
        boardSize: 5,
        showdown: true,
      }),
      { preflopDecision: true, vpip: true, sawFlop: true },
    ],
    [
      'All-in preflop, Board läuft durch: Flop gesehen',
      hand('p:raise', { boardSize: 5, showdown: true }),
      {
        preflopDecision: true,
        vpip: true,
        pfr: true,
        sawFlop: true,
        wentToShowdown: true,
      },
    ],
    [
      'Gewinnt ohne Showdown (Bet, alle folden): kein W$SD',
      hand('p:call f:bet', { boardSize: 3, wonPot: true }),
      {
        preflopDecision: true,
        vpip: true,
        sawFlop: true,
      },
    ],
    ['Abwesend: automatischer Fold', hand('p:fold*'), { absent: true }],
    [
      'Abwesend im Big Blind: automatischer Check, Flop „gesehen“',
      hand('p:bb p:check* f:check* t:fold*', {
        boardSize: 4,
      }),
      { absent: true, sawFlop: true },
    ],
    [
      'Selbst gecallt, später Zeit abgelaufen (Fold): zählt normal',
      hand('p:call f:fold*', { boardSize: 3 }),
      {
        preflopDecision: true,
        vpip: true,
        sawFlop: true,
      },
    ],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    expect(classifyHand(input)).toEqual({ ...NONE, ...expected });
  });
});

describe('aggregateHandStats', () => {
  it('summiert eine bekannte Historie von zehn Händen', () => {
    const history: PlayerHand[] = [
      hand('p:fold'), // 1 Entscheidung
      hand('p:raise'), // 2 VPIP, PFR
      hand('p:call f:check t:call r:call', { boardSize: 5, showdown: true }), // 3 VPIP, Flop, SD verloren
      hand('p:raise f:bet t:check r:check', { boardSize: 5, showdown: true, wonPot: true }), // 4 VPIP, PFR, Flop, SD gewonnen
      hand('p:bb p:check f:check t:fold', { boardSize: 4 }), // 5 Entscheidung, Flop
      hand('p:bb'), // 6 Walk: keine Entscheidung
      hand('p:fold*'), // 7 abwesend
      hand('p:bb p:check* f:check* t:fold*', { boardSize: 4 }), // 8 abwesend, Flop zählt nicht
      hand('p:sb p:call f:fold', { boardSize: 3 }), // 9 VPIP, Flop
      hand('p:bb', { boardSize: 5, showdown: true, wonPot: true }), // 10 All-in per Blind: Flop, SD gewonnen
    ];
    expect(aggregateHandStats(history)).toEqual({
      hands: 10,
      vpip: { count: 4, of: 6 },
      pfr: { count: 2, of: 6 },
      wtsd: { count: 3, of: 5 },
      wsd: { count: 2, of: 3 },
    });
  });

  it('ohne Hände sind alle Nenner 0', () => {
    expect(aggregateHandStats([])).toEqual({
      hands: 0,
      vpip: { count: 0, of: 0 },
      pfr: { count: 0, of: 0 },
      wtsd: { count: 0, of: 0 },
      wsd: { count: 0, of: 0 },
    });
  });
});

describe('playerHandFromRecord', () => {
  const action = (
    seq: number,
    userId: number,
    street: Street,
    a: HandActionType,
    isAutomatic = false,
  ): StoredAction => ({
    seq,
    userId,
    street,
    action: a,
    amount: 0,
    isAllIn: false,
    isAutomatic,
  });
  const record: HandRecord = {
    roundId: 1,
    handNumber: 1,
    buttonSeat: 0,
    smallBlind: 10,
    bigBlind: 20,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    deck: [],
    players: [
      { seat: 0, userId: 10, stack: 500, holeCards: ['As', 'Ad'] },
      { seat: 1, userId: 11, stack: 500, holeCards: ['2c', '7d'] },
      { seat: 2, userId: 12, stack: 500, holeCards: ['Kh', 'Kd'] },
    ],
    board: ['2h', '5s', '9c', 'Jd', '3h'],
    result: {
      showdown: true,
      allHandsShown: false,
      payouts: [{ userId: 10, amount: 1040 }],
      uncalled: null,
      pots: [{ amount: 1040, eligibleUserIds: [10, 12], winnerUserIds: [10], shares: [], winningHand: null }],
      players: [],
    },
    actions: [
      action(1, 11, 'preflop', 'small_blind'),
      action(2, 12, 'preflop', 'big_blind'),
      action(3, 10, 'preflop', 'raise'),
      action(4, 11, 'preflop', 'fold', true),
      action(5, 12, 'preflop', 'call'),
      action(6, 12, 'flop', 'check'),
      action(7, 10, 'flop', 'bet'),
      action(8, 12, 'flop', 'call'),
    ],
  };

  it('nimmt nur die eigenen Aktionen und das Ergebnis der Hand', () => {
    expect(playerHandFromRecord(record, 12)).toEqual({
      actions: [
        { street: 'preflop', action: 'big_blind', isAutomatic: false },
        { street: 'preflop', action: 'call', isAutomatic: false },
        { street: 'flop', action: 'check', isAutomatic: false },
        { street: 'flop', action: 'call', isAutomatic: false },
      ],
      boardSize: 5,
      showdown: true,
      wonPot: false,
    });
    expect(playerHandFromRecord(record, 10)?.wonPot).toBe(true);
    expect(classifyHand(playerHandFromRecord(record, 11) ?? hand(''))).toEqual({ ...NONE, absent: true });
  });

  it('Spieler ohne Karten oder unbeendete Hand → null', () => {
    expect(playerHandFromRecord(record, 99)).toBeNull();
    expect(playerHandFromRecord({ ...record, result: null }, 10)).toBeNull();
  });
});
