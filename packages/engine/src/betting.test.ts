import { describe, expect, it } from 'vitest';
import { applyAction, legalActions, potTotal, startHand, type StartHandOptions } from './betting';
import { createDeck } from './deck';
import type { Action, HandErrorCode, HandState } from './hand-state';
import { createSeededRng } from './rng';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

const p = (id: string, seat: number, stack: number) => ({ id, seat, stack });

function start(options: Omit<StartHandOptions, 'rng'> & Partial<Pick<StartHandOptions, 'rng'>>): HandState {
  const result = startHand({ rng: createSeededRng(42), ...options });
  if (!result.ok) throw new Error(`startHand: ${result.error.message}`);
  return result.state;
}

function act(state: HandState, playerId: string, action: Action): HandState {
  const result = applyAction(state, playerId, action);
  if (!result.ok) throw new Error(`${playerId} ${action.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

type Step = [string, Action];
function play(state: HandState, steps: readonly Step[]): HandState {
  return steps.reduce((s, [id, action]) => act(s, id, action), state);
}

function expectRejected(state: HandState, playerId: string, action: Action, code: HandErrorCode): void {
  const before = JSON.stringify(state);
  const result = applyAction(state, playerId, action);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
  }
  expect(JSON.stringify(state)).toBe(before);
}

function player(state: HandState, id: string) {
  const found = state.players.find((x) => x.id === id);
  if (found === undefined) throw new Error(`kein Spieler ${id}`);
  return found;
}

const chipSum = (s: HandState) => s.players.reduce((sum, x) => sum + x.stack + x.totalBet, 0);
const fold: Action = { type: 'fold' };
const check: Action = { type: 'check' };
const call: Action = { type: 'call' };
const allIn: Action = { type: 'allIn' };
const bet = (amount: number): Action => ({ type: 'bet', amount });
const raise = (amount: number): Action => ({ type: 'raise', amount });

const blinds = { smallBlind: 50, bigBlind: 100 };
/** 3 Spieler: Button A (Sitz 0), SB B (1), BB C (2). */
const threeHanded = (stacks: [number, number, number] = [10_000, 10_000, 10_000]) =>
  start({ players: [p('A', 0, stacks[0]), p('B', 1, stacks[1]), p('C', 2, stacks[2])], buttonSeat: 0, ...blinds });
/** Heads-up: Button/SB A (Sitz 3), BB B (Sitz 7). */
const headsUp = (stacks: [number, number] = [10_000, 10_000]) =>
  start({ players: [p('B', 7, stacks[1]), p('A', 3, stacks[0])], buttonSeat: 3, ...blinds });

// ---------------------------------------------------------------------------
// Start einer Hand
// ---------------------------------------------------------------------------

describe('startHand', () => {
  it('mischt, teilt aus, postet Blinds; preflop agiert der Spieler links vom Big Blind', () => {
    const s = start({
      players: [p('A', 0, 1000), p('B', 2, 1000), p('C', 5, 1000), p('D', 8, 1000)],
      buttonSeat: 2,
      ...blinds,
    });
    expect(s.phase).toBe('betting');
    expect(s.street).toBe('preflop');
    expect([s.smallBlindSeat, s.bigBlindSeat]).toEqual([5, 8]);
    expect(player(s, 'C')).toMatchObject({ stack: 950, streetBet: 50, totalBet: 50, status: 'active' });
    expect(player(s, 'D')).toMatchObject({ stack: 900, streetBet: 100, totalBet: 100 });
    expect(s.toActId).toBe('A'); // links vom BB (Sitz 8) → zyklisch Sitz 0
    expect(s.currentBet).toBe(100);
    expect(s.minRaise).toBe(100);
    expect(s.deck).toHaveLength(52 - 8);
    const all = [...s.deck, ...s.players.flatMap((x) => x.holeCards)];
    expect(new Set(all).size).toBe(52);
    expect(s.players.map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']); // nach Sitz sortiert
  });

  it('teilt reihum aus, erste Karte an den Spieler links vom Button', () => {
    const deck = createDeck();
    const s = start({ players: [p('A', 0, 1000), p('B', 1, 1000), p('C', 2, 1000)], buttonSeat: 0, deck, ...blinds });
    expect(player(s, 'B').holeCards).toEqual([deck[0], deck[3]]);
    expect(player(s, 'C').holeCards).toEqual([deck[1], deck[4]]);
    expect(player(s, 'A').holeCards).toEqual([deck[2], deck[5]]);
  });

  it('gleicher Seed → gleiche Hand', () => {
    const opts = { players: [p('A', 0, 1000), p('B', 1, 1000)], buttonSeat: 0, ...blinds };
    expect(start({ ...opts, rng: createSeededRng(7) })).toEqual(start({ ...opts, rng: createSeededRng(7) }));
  });

  it('Antes: jeder zahlt vorab, zählt zum Gesamt-, nicht zum Straßeneinsatz', () => {
    const s = start({
      players: [p('A', 0, 1000), p('B', 1, 1000), p('C', 2, 1000)],
      buttonSeat: 0,
      ante: 10,
      ...blinds,
    });
    expect(player(s, 'A')).toMatchObject({ stack: 990, streetBet: 0, totalBet: 10 });
    expect(player(s, 'B')).toMatchObject({ stack: 940, streetBet: 50, totalBet: 60 });
    expect(player(s, 'C')).toMatchObject({ stack: 890, streetBet: 100, totalBet: 110 });
    expect(potTotal(s)).toBe(180);
    expect(legalActions(s)).toMatchObject({ playerId: 'A', toCall: 100 });
  });

  it('Blinds mit zu kleinem Stack werden All-in gepostet', () => {
    const s = threeHanded([1000, 30, 70]);
    expect(player(s, 'B')).toMatchObject({ stack: 0, streetBet: 30, status: 'allIn' });
    expect(player(s, 'C')).toMatchObject({ stack: 0, streetBet: 70, status: 'allIn' });
    // Zu callen ist trotzdem der volle Big Blind (TDA).
    expect(s.currentBet).toBe(100);
    expect(legalActions(s)).toMatchObject({ playerId: 'A', toCall: 100 });
    // A ist der einzige handlungsfähige Spieler: nur Call/Fold, kein Raise.
    expect(legalActions(s)?.actions.map((a) => a.type)).toEqual(['fold', 'call']);
    const done = act(s, 'A', call);
    expect(done.phase).toBe('showdown');
    expect(done.board).toHaveLength(5);
  });

  it('Ante bringt Spieler All-in: kann keinen Blind mehr posten', () => {
    const s = start({ players: [p('A', 0, 1000), p('B', 1, 10), p('C', 2, 1000)], buttonSeat: 0, ante: 10, ...blinds });
    expect(player(s, 'B')).toMatchObject({ stack: 0, streetBet: 0, totalBet: 10, status: 'allIn' });
    expect(s.toActId).toBe('A');
  });

  it('Heads-up, Big Blind für weniger als den Small Blind All-in → Board läuft sofort durch', () => {
    const s = headsUp([1000, 30]);
    expect(s.phase).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(s.burned).toHaveLength(3);
    expect(s.toActId).toBeNull();
    expect(legalActions(s)).toBeNull();
  });

  it('expliziter Dead Small Blind (WP-008): nur Big Blind wird gepostet', () => {
    const s = start({
      players: [p('A', 0, 1000), p('B', 2, 1000), p('C', 3, 1000)],
      buttonSeat: 1, // leerer Sitz (Dead Button)
      blinds: { smallBlindSeat: null, bigBlindSeat: 2 },
      ...blinds,
    });
    expect(potTotal(s)).toBe(100);
    expect(s.toActId).toBe('C');
  });

  it.each<[string, Partial<StartHandOptions>]>([
    ['zu wenige Spieler', { players: [p('A', 0, 100)] }],
    ['zu viele Spieler (D-007)', { players: Array.from({ length: 10 }, (_, i) => p(`P${String(i)}`, i, 100)) }],
    ['doppelte ID', { players: [p('A', 0, 100), p('A', 1, 100)] }],
    ['doppelter Sitz', { players: [p('A', 0, 100), p('B', 0, 100)] }],
    ['Stack 0', { players: [p('A', 0, 100), p('B', 1, 0)] }],
    ['Big Blind < Small Blind', { smallBlind: 100, bigBlind: 50 }],
    ['Blind keine ganze Zahl', { smallBlind: 0.5 }],
    ['negatives Ante', { ante: -1 }],
    ['Blind-Sitz unbesetzt', { blinds: { smallBlindSeat: 0, bigBlindSeat: 5 } }],
    ['Deck mit Duplikaten', { deck: ['As', 'As', ...createDeck().slice(2)] }],
    ['Deck zu kurz', { deck: createDeck().slice(0, 11) }],
  ])('lehnt ungültigen Aufbau ab: %s', (_, override) => {
    const result = startHand({
      players: [p('A', 0, 100), p('B', 1, 100)],
      buttonSeat: 0,
      ...blinds,
      rng: createSeededRng(1),
      ...override,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_SETUP');
  });

  it('ohne rng und ohne deck → Fehler', () => {
    const result = startHand({ players: [p('A', 0, 100), p('B', 1, 100)], buttonSeat: 0, ...blinds });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Heads-up
// ---------------------------------------------------------------------------

describe('Heads-up', () => {
  it('Button ist Small Blind, agiert preflop zuerst und postflop zuletzt', () => {
    let s = headsUp();
    expect([s.smallBlindSeat, s.bigBlindSeat]).toEqual([3, 7]);
    expect(player(s, 'A').streetBet).toBe(50);
    expect(s.toActId).toBe('A');
    s = act(s, 'A', call);
    // BB-Option: Check oder Raise.
    expect(s.toActId).toBe('B');
    expect(legalActions(s)?.actions).toEqual([
      { type: 'fold' },
      { type: 'check' },
      { type: 'raise', min: 200, max: 10_000 },
      { type: 'allIn', amount: 9900, to: 10_000 },
    ]);
    s = act(s, 'B', check);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.burned).toHaveLength(1);
    expect(s.toActId).toBe('B'); // postflop: Big Blind zuerst
    s = play(s, [
      ['B', check],
      ['A', check],
    ]);
    expect(s.street).toBe('turn');
    expect(s.toActId).toBe('B');
    s = play(s, [
      ['B', bet(100)],
      ['A', call],
    ]);
    expect(s.street).toBe('river');
    s = play(s, [
      ['B', check],
      ['A', check],
    ]);
    expect(s.phase).toBe('showdown');
    expect(s.board).toHaveLength(5);
    expect(s.burned).toHaveLength(3);
    expect(s.deck).toHaveLength(52 - 4 - 8);
    expect(player(s, 'A').totalBet).toBe(200);
    expect(player(s, 'B').totalBet).toBe(200);
    expect(s.payouts).toBeNull(); // Pot-Aufteilung: WP-007
  });

  it('Small Blind foldet → Big Blind gewinnt ohne Showdown', () => {
    const s = act(headsUp(), 'A', fold);
    expect(s.phase).toBe('complete');
    expect(s.payouts).toEqual([{ playerId: 'B', amount: 150 }]);
    expect(player(s, 'B').stack).toBe(10_050);
    expect(player(s, 'A').stack).toBe(9950);
    expect(s.players.reduce((sum, x) => sum + x.stack, 0)).toBe(20_000);
    expect(legalActions(s)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mehrere Spieler, Mindest-Bets und -Raises
// ---------------------------------------------------------------------------

describe('No-Limit-Regeln', () => {
  it('BB-Option nach Limps; BB-Raise öffnet die Runde für alle', () => {
    let s = play(threeHanded(), [
      ['A', call],
      ['B', call],
    ]);
    expect(s.toActId).toBe('C');
    expect(legalActions(s)?.actions.map((a) => a.type)).toEqual(['fold', 'check', 'raise', 'allIn']);
    s = act(s, 'C', raise(300));
    expect(s.toActId).toBe('A');
    expect(legalActions(s)).toMatchObject({ toCall: 200 });
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 500, max: 10_000 });
  });

  it('BB checkt seine Option → Flop, erster Spieler links vom Button', () => {
    const s = play(threeHanded(), [
      ['A', call],
      ['B', call],
      ['C', check],
    ]);
    expect(s.street).toBe('flop');
    expect(s.toActId).toBe('B');
    expect(s.currentBet).toBe(0);
    expect(s.players.every((x) => x.streetBet === 0 && x.totalBet === 100)).toBe(true);
  });

  it('Mindest-Bet = Big Blind, Mindest-Raise = letzter voller Raise, Re-Raise', () => {
    let s = play(threeHanded(), [
      ['A', call],
      ['B', call],
      ['C', check],
    ]);
    expectRejected(s, 'B', bet(99), 'AMOUNT_TOO_SMALL');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'bet', min: 100, max: 9900 });
    s = act(s, 'B', bet(150));
    expect(s.minRaise).toBe(150);
    expectRejected(s, 'C', raise(299), 'AMOUNT_TOO_SMALL');
    s = act(s, 'C', raise(300));
    expect(s.minRaise).toBe(150);
    s = act(s, 'A', raise(700)); // Re-Raise um 400
    expect(s.currentBet).toBe(700);
    expect(s.minRaise).toBe(400);
    expect(legalActions(s)).toMatchObject({ playerId: 'B', toCall: 550 });
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 1100, max: 9900 });
    s = play(s, [
      ['B', fold],
      ['C', call],
    ]);
    expect(s.street).toBe('turn');
    expect(s.toActId).toBe('C'); // B gefoldet → wird übersprungen
    expect(potTotal(s)).toBe(300 + 150 + 700 + 700); // Preflop 300, Flop: B 150, A 700, C 700
    expect(chipSum(s)).toBe(30_000);
  });

  it('Preflop-Mindest-Raise ist auf 2 BB, Raise und Re-Raise preflop', () => {
    let s = threeHanded();
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 200, max: 10_000 });
    s = act(s, 'A', raise(250));
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 400, max: 10_000 });
    s = act(s, 'B', raise(400));
    s = act(s, 'C', fold);
    expect(s.toActId).toBe('A');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 550, max: 10_000 });
  });

  it('unvollständiger All-in-Raise öffnet die Runde nur für noch nicht agierte Spieler', () => {
    // A raist auf 300 (Raise um 200), B geht für 400 All-in (nur +100 → unvollständig).
    let s = threeHanded([10_000, 400, 10_000]);
    s = act(s, 'A', raise(300));
    s = act(s, 'B', allIn);
    expect(s.currentBet).toBe(400);
    expect(s.minRaise).toBe(200); // bleibt beim letzten vollen Raise
    expect(s.log.at(-1)).toMatchObject({ type: 'raise', playerId: 'B', to: 400, allIn: true });
    // C (BB) hat noch nicht freiwillig agiert → darf raisen, mindestens auf 400 + 200.
    expect(s.toActId).toBe('C');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 600, max: 10_000 });
    s = act(s, 'C', call);
    // A hat schon agiert und sieht nur +100 → nur Call oder Fold.
    expect(s.toActId).toBe('A');
    expect(legalActions(s)?.actions).toEqual([{ type: 'fold' }, { type: 'call', amount: 100 }]);
    expectRejected(s, 'A', raise(600), 'ILLEGAL_ACTION');
    expectRejected(s, 'A', allIn, 'ILLEGAL_ACTION');
    s = act(s, 'A', call);
    expect(s.street).toBe('flop');
  });

  it('voller All-in-Raise öffnet die Runde wieder', () => {
    // Flop: B bettet 100, C geht für 350 All-in (+250 ≥ 100 → voller Raise), A callt.
    let s = play(threeHanded([10_000, 10_000, 450]), [
      ['A', call],
      ['B', call],
      ['C', check],
      ['B', bet(100)],
      ['C', allIn],
    ]);
    expect(s.minRaise).toBe(250);
    s = act(s, 'A', call);
    // B sieht +250 seit seinem Bet → darf wieder erhöhen.
    expect(s.toActId).toBe('B');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 600, max: 9900 });
  });

  it('mehrere unvollständige All-ins, die zusammen einen vollen Raise ergeben, öffnen die Runde (TDA)', () => {
    let s = start({
      players: [p('A', 0, 10_000), p('B', 1, 10_000), p('C', 2, 10_000), p('D', 3, 250), p('E', 4, 310)],
      buttonSeat: 4,
      ...blinds,
    });
    // Preflop: SB A, BB B, C am Zug.
    expect(s.toActId).toBe('C');
    s = play(s, [
      ['C', call],
      ['D', allIn], // 250: +150 ≥ 100 → voller Raise, minRaise 150
      ['E', allIn], // 310: +60 → unvollständig
      ['A', fold],
      ['B', call], // B hat noch nicht agiert
    ]);
    // C hat 100 gebracht und sieht jetzt +210 ≥ 150 → darf raisen.
    expect(s.toActId).toBe('C');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 460, max: 10_000 });
  });

  it('postflop All-in-Bet unter dem Big Blind ist unvollständig, Mindest-Raise bleibt 1 BB darüber', () => {
    let s = threeHanded([10_000, 10_000, 130]);
    s = play(s, [
      ['A', call],
      ['B', call],
      ['C', check],
      ['B', check],
    ]);
    expect(s.toActId).toBe('C');
    expect(legalActions(s)?.actions).toEqual([
      { type: 'fold' },
      { type: 'check' },
      { type: 'allIn', amount: 30, to: 30 },
    ]);
    expectRejected(s, 'C', bet(30), 'ILLEGAL_ACTION'); // weniger als 1 BB nur per allIn
    s = act(s, 'C', allIn);
    expect(s.currentBet).toBe(30);
    expect(s.minRaise).toBe(100);
    expect(s.toActId).toBe('A');
    expect(legalActions(s)?.actions).toContainEqual({ type: 'raise', min: 130, max: 9900 });
    // B hat gecheckt; +30 ist kein voller Raise → nur Call/Fold, falls A nur callt.
    s = act(s, 'A', call);
    expect(s.toActId).toBe('B');
    expect(legalActions(s)?.actions).toEqual([{ type: 'fold' }, { type: 'call', amount: 30 }]);
  });

  it('Call mit zu kleinem Stack ist ein All-in-Call', () => {
    let s = threeHanded([10_000, 10_000, 500]);
    s = act(s, 'A', raise(1000));
    s = act(s, 'B', fold);
    expect(legalActions(s)).toMatchObject({ playerId: 'C', toCall: 400 });
    expect(legalActions(s)?.actions).toEqual([
      { type: 'fold' },
      { type: 'call', amount: 400 },
      { type: 'allIn', amount: 400, to: 500 },
    ]);
    s = act(s, 'C', call);
    expect(player(s, 'C')).toMatchObject({ stack: 0, status: 'allIn', totalBet: 500 });
    expect(s.phase).toBe('showdown'); // A ist allein handlungsfähig und hat C überdeckt
    expect(s.board).toHaveLength(5);
    expect(player(s, 'A').totalBet).toBe(1000); // nicht gecallte 500 gibt WP-007 zurück
  });

  it('alle All-in preflop → Board läuft automatisch bis zum River', () => {
    const s = play(threeHanded([1000, 2000, 3000]), [
      ['A', allIn],
      ['B', allIn],
      ['C', call],
    ]);
    expect(s.phase).toBe('showdown');
    expect(s.street).toBe('river');
    expect(s.board).toHaveLength(5);
    expect(s.burned).toHaveLength(3);
    expect(s.players.map((x) => x.totalBet)).toEqual([1000, 2000, 2000]);
    expect(player(s, 'C')).toMatchObject({ status: 'active', stack: 1000 });
    expect(chipSum(s)).toBe(6000);
  });

  it('nur noch ein handlungsfähiger Spieler auf dem Flop → Board läuft durch', () => {
    const s = play(threeHanded([10_000, 10_000, 600]), [
      ['A', call],
      ['B', fold],
      ['C', check],
      ['C', allIn],
      ['A', call],
    ]);
    expect(s.phase).toBe('showdown');
    expect(s.board).toHaveLength(5);
  });

  it('alle bis auf einen folden → Gewinner bekommt den ganzen Pot ohne Showdown', () => {
    const s = play(threeHanded(), [
      ['A', raise(300)],
      ['B', fold],
      ['C', fold],
    ]);
    expect(s.phase).toBe('complete');
    expect(s.payouts).toEqual([{ playerId: 'A', amount: 450 }]);
    expect(player(s, 'A').stack).toBe(10_150);
    expect(s.board).toEqual([]);
    expect(s.players.reduce((sum, x) => sum + x.stack, 0)).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Ungültige Aktionen
// ---------------------------------------------------------------------------

describe('ungültige Aktionen lassen den Zustand unverändert', () => {
  const s = threeHanded();

  it.each<[string, string, Action, HandErrorCode]>([
    ['nicht am Zug', 'B', call, 'NOT_YOUR_TURN'],
    ['unbekannter Spieler', 'X', call, 'UNKNOWN_PLAYER'],
    ['Check bei offenem Bet', 'A', check, 'ILLEGAL_ACTION'],
    ['Bet obwohl schon gesetzt wurde', 'A', bet(300), 'ILLEGAL_ACTION'],
    ['Raise zu klein', 'A', raise(150), 'AMOUNT_TOO_SMALL'],
    ['Raise größer als Stack', 'A', raise(10_001), 'AMOUNT_TOO_LARGE'],
    ['Betrag keine ganze Zahl', 'A', raise(250.5), 'INVALID_ACTION'],
    ['Betrag fehlt', 'A', { type: 'raise' } as unknown as Action, 'INVALID_ACTION'],
    ['unbekannter Typ', 'A', { type: 'muck' } as unknown as Action, 'INVALID_ACTION'],
  ])('%s', (_, id, action, code) => {
    expectRejected(s, id, action, code);
  });

  it('Call ohne offenen Einsatz und Raise ohne Bet postflop', () => {
    const flop = play(s, [
      ['A', call],
      ['B', call],
      ['C', check],
    ]);
    expectRejected(flop, 'B', call, 'ILLEGAL_ACTION');
    expectRejected(flop, 'B', raise(200), 'ILLEGAL_ACTION');
    expectRejected(flop, 'B', bet(10_000), 'AMOUNT_TOO_LARGE');
  });

  it('Aktion nach Ende der Hand', () => {
    const done = play(s, [
      ['A', fold],
      ['B', fold],
    ]);
    expectRejected(done, 'C', check, 'HAND_NOT_IN_BETTING');
  });

  it('erfolgreiche Aktion verändert den Eingabezustand nicht', () => {
    const before = JSON.stringify(s);
    const next = act(s, 'A', raise(300));
    expect(JSON.stringify(s)).toBe(before);
    expect(next).not.toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Serialisierbarkeit
// ---------------------------------------------------------------------------

describe('Serialisierbarkeit', () => {
  it('JSON-Kopie verhält sich in allen Funktionen identisch', () => {
    const steps: Step[] = [
      ['A', raise(300)],
      ['B', call],
      ['C', call],
      ['B', bet(500)],
      ['C', fold],
      ['A', call],
      ['B', check],
      ['A', check],
    ];
    let s = threeHanded();
    for (const [id, action] of steps) {
      const copy = JSON.parse(JSON.stringify(s)) as HandState;
      expect(copy).toEqual(s);
      expect(legalActions(copy)).toEqual(legalActions(s));
      const a = act(s, id, action);
      const b = act(copy, id, action);
      expect(b).toEqual(a);
      s = a;
    }
    expect(s.street).toBe('river');
  });
});
