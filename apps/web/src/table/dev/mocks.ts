/** Mock-Tischzustände für die Testseite, Komponenten- und Screenshot-Tests (WP-016). */
import type { Card, HoleCardsView, PlayerSeatView, SeatView, TableView } from '../types';
import { MAX_SEATS } from '../types';

const HIDDEN: HoleCardsView = { kind: 'hidden' };
const NONE: HoleCardsView = { kind: 'none' };

function own(a: Card, b: Card): HoleCardsView {
  return { kind: 'visible', cards: [a, b] };
}
function shown(a: Card, b: Card): HoleCardsView {
  return { kind: 'shown', cards: [a, b] };
}

function player(
  name: string,
  stack: number,
  extra: Partial<Omit<PlayerSeatView, 'kind' | 'name' | 'stack'>> = {},
): PlayerSeatView {
  return { kind: 'player', name, stack, bet: 0, status: 'active', connected: true, holeCards: HIDDEN, ...extra };
}

/** Baut die 9 Sitze; nicht genannte Sitze sind leer. */
function seats(bySeat: Record<number, PlayerSeatView>): SeatView[] {
  return Array.from({ length: MAX_SEATS }, (_, i) => bySeat[i] ?? { kind: 'empty' });
}

export interface MockState {
  readonly id: string;
  readonly label: string;
  readonly view: TableView;
}

const headsUp: TableView = {
  seats: seats({
    2: player('Arthur', 1450, { bet: 50, holeCards: own('As', 'Kd'), avatar: 'fox' }),
    6: player('Lena', 1400, { bet: 100, avatar: 'owl' }),
  }),
  heroSeat: 2,
  buttonSeat: 2,
  smallBlindSeat: 2,
  bigBlindSeat: 6,
  toActSeat: 2,
  timeRemaining: 0.8,
  board: [],
  pots: [],
  blinds: { small: 50, big: 100, level: 2 },
};

const sixFlop: TableView = {
  seats: seats({
    0: player('Arthur', 8_450, { bet: 600, holeCards: own('Qh', 'Qc'), avatar: 'fox' }),
    1: player('Lena', 12_300, { bet: 600, avatar: 'owl' }),
    2: player('Tobias', 4_100, { status: 'folded', holeCards: NONE }),
    4: player('Mia', 9_900, { bet: 1_800, avatar: 'cat' }),
    5: player('Jonas', 7_200, { status: 'folded', holeCards: NONE }),
    7: player('Sophie', 15_750, { avatar: 'rocket' }),
  }),
  heroSeat: 0,
  buttonSeat: 4,
  smallBlindSeat: 5,
  bigBlindSeat: 7,
  toActSeat: 7,
  timeRemaining: 0.45,
  board: ['Td', '7s', '2h'],
  pots: [{ amount: 3_600 }],
  blinds: { small: 100, big: 200, level: 4 },
  reactions: [
    { id: 1, seat: 0, emoji: '👍', label: 'Daumen hoch' },
    { id: 2, seat: 4, emoji: '😂', label: 'Lachen' },
  ],
};

const ninePreflop: TableView = {
  seats: seats({
    0: player('Paul', 9_800, { avatar: 'bear' }),
    1: player('Maximilian', 10_000, { avatar: 'spade' }),
    2: player('Kim', 9_950, { bet: 50, avatar: 'frog' }),
    3: player('Ole', 9_900, { bet: 100, avatar: 'lion' }),
    4: player('Arthur', 10_000, { holeCards: own('Jc', 'Th'), avatar: 'fox' }),
    5: player('Lena', 9_700, { status: 'folded', holeCards: NONE, avatar: 'panda' }),
    6: player('Sophie', 10_250, { connected: false, avatar: 'crown' }),
    7: player('Tobias', 9_700, { bet: 300, avatar: 'ghost' }),
    8: player('Mia', 10_400, { status: 'folded', holeCards: NONE, avatar: 'cactus' }),
  }),
  heroSeat: 4,
  buttonSeat: 1,
  smallBlindSeat: 2,
  bigBlindSeat: 3,
  toActSeat: 4,
  timeRemaining: 0.9,
  board: [],
  pots: [{ amount: 150 }],
  blinds: { small: 50, big: 100, level: 1 },
};

const nineAllIn: TableView = {
  seats: seats({
    0: player('Paul', 0, { status: 'allIn', bet: 1_200, avatar: 'bear' }),
    1: player('Maximilian', 18_200, { bet: 6_400, avatar: 'spade' }),
    2: player('Kim', 0, { status: 'allIn', bet: 3_100, avatar: 'frog' }),
    3: player('Ole', 5_300, { status: 'folded', holeCards: NONE, avatar: 'lion' }),
    4: player('Arthur', 11_600, { holeCards: own('8s', '8d'), avatar: 'fox' }),
    5: player('Lena', 0, { status: 'eliminated', holeCards: NONE, avatar: 'panda' }),
    6: player('Sophie', 7_400, { status: 'folded', holeCards: NONE, avatar: 'crown' }),
    7: player('Tobias', 9_050, { status: 'folded', holeCards: NONE, connected: false, avatar: 'ghost' }),
    8: player('Mia', 2_150, { status: 'folded', holeCards: NONE, avatar: 'cactus' }),
  }),
  heroSeat: 4,
  buttonSeat: 8,
  smallBlindSeat: 0,
  bigBlindSeat: 1,
  toActSeat: 4,
  timeRemaining: 0.3,
  board: ['Ah', '9c', '9d', '4s'],
  pots: [{ amount: 6_400 }, { amount: 5_700 }, { amount: 4_200 }],
  blinds: { small: 200, big: 400, level: 6, ante: 50 },
};

const sixShowdown: TableView = {
  seats: seats({
    0: player('Arthur', 6_900, { holeCards: own('Kh', 'Jh') }),
    1: player('Lena', 0, { status: 'allIn', holeCards: shown('Ac', 'Qd'), avatar: 'owl' }),
    3: player('Tobias', 3_400, { status: 'folded', holeCards: NONE }),
    4: player('Mia', 11_250, { holeCards: shown('Ts', '9s'), avatar: 'cat' }),
    6: player('Jonas', 5_600, { status: 'folded', holeCards: NONE }),
    8: player('Sophie', 8_850, { status: 'folded', holeCards: NONE }),
  }),
  heroSeat: 0,
  buttonSeat: 3,
  smallBlindSeat: 4,
  bigBlindSeat: 6,
  toActSeat: null,
  board: ['Qh', 'Th', '3c', '8d', '2h'],
  pots: [{ amount: 9_600 }, { amount: 2_400 }],
  blinds: { small: 150, big: 300, level: 5 },
  // WP-031: Arthur gewinnt mit dem Herz-Flush – Plakette und Gewinnerhand hervorgehoben.
  winnerSeats: [0],
  winningCards: ['Kh', 'Qh', 'Jh', 'Th', '2h'],
};

const sixDisconnected: TableView = {
  seats: seats({
    1: player('Ole', 4_800, { bet: 400, connected: false }),
    2: player('Kim', 0, { status: 'eliminated', holeCards: NONE }),
    3: player('Arthur', 13_200, { bet: 400, holeCards: own('5c', '4c'), avatar: 'fox' }),
    5: player('Maximilian', 125_500, { bet: 1_200, avatar: 'robot' }),
    6: player('Lena', 6_900, { status: 'folded', holeCards: NONE, connected: false }),
    8: player('Paul', 0, { status: 'allIn', bet: 900, connected: false }),
  }),
  heroSeat: 3,
  buttonSeat: 1,
  smallBlindSeat: 3,
  bigBlindSeat: 5,
  toActSeat: 1,
  timeRemaining: 0.15,
  board: ['Kc', 'Kh', '6d', '6s', 'Jc'],
  pots: [{ amount: 7_600 }],
  blinds: { small: 200, big: 400, level: 7 },
};

/** Variante von `ninePreflop` mit n Spielern (eigener Sitz 4 bleibt), für Layout-Prüfungen. */
function withPlayers(n: number): TableView {
  const keep = [4, 0, 7, 2, 6, 1, 8, 3, 5].slice(0, n);
  return {
    ...ninePreflop,
    seats: ninePreflop.seats.map((s, i) => (keep.includes(i) ? s : { kind: 'empty' })),
    buttonSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
  };
}

export const MOCK_STATES: readonly MockState[] = [
  { id: 'heads-up', label: '2 Spieler – Preflop, eigene Karten', view: headsUp },
  { id: 'six-flop', label: '6 Spieler – Flop mit Einsätzen', view: sixFlop },
  { id: 'nine-preflop', label: '9 Spieler – Preflop, einer getrennt', view: ninePreflop },
  { id: 'nine-allin', label: '9 Spieler – All-in mit Side Pots', view: nineAllIn },
  { id: 'six-showdown', label: '6 Spieler – Showdown', view: sixShowdown },
  { id: 'six-disconnected', label: '6 Spieler – Getrennt/Ausgeschieden', view: sixDisconnected },
  ...[3, 4, 5, 7, 8].map((n) => ({
    id: `players-${String(n)}`,
    label: `${String(n)} Spieler – Layout`,
    view: withPlayers(n),
  })),
];

export function mockById(id: string): MockState | undefined {
  return MOCK_STATES.find((m) => m.id === id);
}
