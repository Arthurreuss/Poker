/**
 * Setzrunden einer Hand als reine Zustandsmaschine (WP-006):
 * `startHand` → (`legalActions` / `applyAction`)* → Phase `showdown` oder `complete`.
 * Eingabezustände werden nie verändert. Semantik: ARCHITECTURE.md, „Engine: Zustandsmodell einer Hand“.
 */
import { isCard, type Card } from './cards';
import { shuffledDeck } from './deck';
import type {
  Action,
  HandError,
  HandErrorCode,
  HandEvent,
  HandPlayer,
  ActionResult,
  HandState,
  LegalAction,
  LegalActions,
  Street,
} from './hand-state';
import type { Rng } from './rng';

export interface StartHandPlayer {
  id: string;
  seat: number;
  stack: number;
}

export interface StartHandOptions {
  /** 2–9 Spieler (D-007) mit positivem Stack. Reihenfolge egal, maßgeblich ist der Sitz. */
  players: readonly StartHandPlayer[];
  /** Sitz des Buttons; darf ein leerer Sitz sein (Dead Button, dann `blinds` angeben). */
  buttonSeat: number;
  smallBlind: number;
  bigBlind: number;
  /** Ante pro Spieler (Standard 0), wird vor den Blinds gezahlt und zählt nicht zum Straßeneinsatz. */
  ante?: number;
  /**
   * Explizite Blind-Sitze (für Dead-Button-Regeln, WP-008). Ohne Angabe: Heads-up ist der Button
   * Small Blind, sonst die nächsten beiden besetzten Sitze links vom Button.
   */
  blinds?: { smallBlindSeat: number | null; bigBlindSeat: number };
  /** Zufallsquelle zum Mischen (Betrieb: `cryptoRng`). */
  rng?: Rng;
  /** Vorgegebenes Deck (Index 0 = oben) statt Mischen – nur für Tests/Simulationen. */
  deck?: readonly Card[];
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9; // D-007

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/** Startet eine Hand: Deck mischen, Hole Cards austeilen, Antes und Blinds posten. */
export function startHand(options: StartHandOptions): ActionResult {
  const setupError = validateSetup(options);
  if (setupError !== null) return fail('INVALID_SETUP', setupError);

  const sorted = [...options.players].sort((a, b) => a.seat - b.seat);
  const ante = options.ante ?? 0;
  const { smallBlindSeat, bigBlindSeat } = options.blinds ?? defaultBlindSeats(sorted, options.buttonSeat);

  let deck: Card[];
  if (options.deck !== undefined) {
    deck = [...options.deck];
  } else if (options.rng !== undefined) {
    deck = shuffledDeck(options.rng);
  } else {
    return fail('INVALID_SETUP', 'Weder rng noch deck angegeben');
  }

  const state: HandState = {
    smallBlind: options.smallBlind,
    bigBlind: options.bigBlind,
    ante,
    buttonSeat: options.buttonSeat,
    smallBlindSeat,
    bigBlindSeat,
    players: sorted.map((p) => ({
      id: p.id,
      seat: p.seat,
      startStack: p.stack,
      stack: p.stack,
      holeCards: [],
      status: 'active',
      streetBet: 0,
      totalBet: 0,
      hasActed: false,
    })),
    deck,
    burned: [],
    board: [],
    street: 'preflop',
    phase: 'betting',
    toActId: null,
    currentBet: options.bigBlind,
    minRaise: options.bigBlind,
    log: [],
    payouts: null,
  };

  // Hole Cards: reihum, eine Karte pro Durchgang, beginnend links vom Button.
  const dealOrder = clockwiseFrom(state.players, state.buttonSeat);
  for (let round = 0; round < 2; round++) {
    for (const p of dealOrder) p.holeCards.push(drawCard(state));
  }

  // Antes (tote Chips, kein Straßeneinsatz), dann Small und Big Blind. Zu kleiner Stack → All-in.
  if (ante > 0) {
    for (const p of dealOrder) {
      const amount = Math.min(ante, p.stack);
      moveChips(p, amount, false);
      record(state, p, 'ante', amount);
    }
  }
  if (smallBlindSeat !== null) postBlind(state, playerAtSeat(state, smallBlindSeat), state.smallBlind, 'smallBlind');
  postBlind(state, playerAtSeat(state, bigBlindSeat), state.bigBlind, 'bigBlind');

  proceed(state, bigBlindSeat);
  return { ok: true, state };
}

/** Wer am Zug ist und was er darf; `null`, wenn gerade niemand handeln muss. */
export function legalActions(state: HandState): LegalActions | null {
  if (state.phase !== 'betting' || state.toActId === null) return null;
  const player = state.players.find((p) => p.id === state.toActId);
  if (player === undefined) return null;
  const o = options(state, player);
  const actions: LegalAction[] = [{ type: 'fold' }];
  if (o.toCall === 0) actions.push({ type: 'check' });
  else actions.push({ type: 'call', amount: o.toCall });
  if (o.bet !== null) actions.push({ type: 'bet', ...o.bet });
  if (o.raise !== null) actions.push({ type: 'raise', ...o.raise });
  if (o.allIn) actions.push({ type: 'allIn', amount: player.stack, to: player.streetBet + player.stack });
  return { playerId: player.id, toCall: o.toCall, actions };
}

/**
 * Wendet eine Aktion an. Bei Fehlern `{ ok: false, error }` – der Eingabezustand bleibt
 * in jedem Fall unverändert, bei Erfolg kommt ein neuer Zustand zurück.
 */
export function applyAction(state: HandState, playerId: string, action: Action): ActionResult {
  if (state.phase !== 'betting' || state.toActId === null) {
    return fail('HAND_NOT_IN_BETTING', `Keine Setzrunde aktiv (Phase: ${state.phase})`);
  }
  const original = state.players.find((p) => p.id === playerId);
  if (original === undefined)
    return fail('UNKNOWN_PLAYER', `Spieler ${JSON.stringify(playerId)} ist nicht in der Hand`);
  if (state.toActId !== playerId) {
    return fail('NOT_YOUR_TURN', `${playerId} ist nicht am Zug, sondern ${state.toActId}`);
  }

  const shapeError = validateActionShape(action);
  if (shapeError !== null) return fail('INVALID_ACTION', shapeError);

  const o = options(state, original);
  const maxTo = original.streetBet + original.stack;

  switch (action.type) {
    case 'fold':
      break;
    case 'check':
      if (o.toCall > 0) {
        return fail('ILLEGAL_ACTION', `Check nicht möglich: offener Einsatz, ${String(o.toCall)} zum Callen`);
      }
      break;
    case 'call':
      if (o.toCall === 0) return fail('ILLEGAL_ACTION', 'Nichts zu callen – Check verwenden');
      break;
    case 'bet':
      if (o.bet === null) {
        return fail(
          'ILLEGAL_ACTION',
          state.currentBet > 0
            ? 'Bet nicht möglich: es gibt schon einen Einsatz – Raise verwenden'
            : 'Bet nicht möglich: Stack reicht nicht für einen Mindest-Bet oder niemand kann reagieren – allIn verwenden',
        );
      }
      {
        const err = checkRange('Bet', action.amount, o.bet.min, o.bet.max);
        if (err !== null) return { ok: false, error: err };
      }
      break;
    case 'raise':
      if (o.raise === null) return fail('ILLEGAL_ACTION', raiseUnavailableReason(state, original, o.toCall, maxTo));
      {
        const err = checkRange('Raise', action.amount, o.raise.min, o.raise.max);
        if (err !== null) return { ok: false, error: err };
      }
      break;
    case 'allIn':
      if (!o.allIn) {
        return fail(
          'ILLEGAL_ACTION',
          'All-in wäre ein Raise, Raisen ist hier aber nicht erlaubt (unvollständiger All-in-Raise öffnet die Setzrunde nicht wieder oder niemand kann reagieren) – nur Call oder Fold',
        );
      }
      break;
  }

  const next = cloneState(state);
  const player = playerById(next, playerId);
  switch (action.type) {
    case 'fold':
      player.status = 'folded';
      record(next, player, 'fold', 0);
      break;
    case 'check':
      record(next, player, 'check', 0);
      break;
    case 'call': {
      const amount = Math.min(next.currentBet - player.streetBet, player.stack);
      moveChips(player, amount, true);
      record(next, player, 'call', amount);
      break;
    }
    case 'bet':
    case 'raise':
      wagerTo(next, player, action.amount);
      break;
    case 'allIn':
      wagerTo(next, player, maxTo);
      break;
  }
  player.hasActed = true;
  proceed(next, player.seat);
  return { ok: true, state: next };
}

/** Summe aller Einsätze dieser Hand (alle Pots zusammen, solange noch nicht ausgezahlt). */
export function potTotal(state: HandState): number {
  return state.players.reduce((sum, p) => sum + p.totalBet, 0);
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

interface Options {
  toCall: number;
  bet: { min: number; max: number } | null;
  raise: { min: number; max: number } | null;
  allIn: boolean;
}

/** Erlaubte Optionen des Spielers am Zug – einzige Quelle für `legalActions` und `applyAction`. */
function options(state: HandState, player: HandPlayer): Options {
  const toCall = Math.min(Math.max(state.currentBet - player.streetBet, 0), player.stack);
  const maxTo = player.streetBet + player.stack;
  // Niemand außer ihm kann noch handeln → Erhöhen ist sinnlos und nicht erlaubt.
  const opponentCanAct = state.players.some((p) => p.id !== player.id && p.status === 'active');
  // Unvollständige All-in-Raises öffnen die Runde für Spieler, die schon gehandelt haben, nicht wieder,
  // außer die Erhöhungen seit seiner letzten Aktion ergeben zusammen mindestens einen vollen Raise.
  const reopened = !player.hasActed || state.currentBet - player.streetBet >= state.minRaise;
  const mayIncrease = opponentCanAct && reopened && maxTo > state.currentBet;

  let bet: Options['bet'] = null;
  let raise: Options['raise'] = null;
  if (mayIncrease) {
    const min = state.currentBet === 0 ? state.bigBlind : state.currentBet + state.minRaise;
    if (maxTo >= min) {
      if (state.currentBet === 0) bet = { min, max: maxTo };
      else raise = { min, max: maxTo };
    }
  }
  // All-in ist immer erlaubt, wenn es höchstens ein Call ist oder Erhöhen erlaubt ist.
  const allIn = player.stack > 0 && (maxTo <= state.currentBet || mayIncrease);
  return { toCall, bet, raise, allIn };
}

function raiseUnavailableReason(state: HandState, player: HandPlayer, toCall: number, maxTo: number): string {
  if (state.currentBet === 0) return 'Raise nicht möglich: noch kein Einsatz – Bet verwenden';
  if (maxTo <= state.currentBet) return 'Raise nicht möglich: Stack reicht nur zum Callen';
  if (!state.players.some((p) => p.id !== player.id && p.status === 'active')) {
    return 'Raise nicht möglich: kein Gegner kann mehr reagieren';
  }
  if (player.hasActed && toCall < state.minRaise) {
    return 'Raise nicht möglich: ein unvollständiger All-in-Raise öffnet die Setzrunde nicht wieder – nur Call oder Fold';
  }
  return `Raise nicht möglich: Stack reicht nicht für einen Mindest-Raise auf ${String(state.currentBet + state.minRaise)} – allIn verwenden`;
}

/** Bet/Raise/All-in auf Straßeneinsatz `to`. Vollständig, wenn die Erhöhung ≥ `minRaise` ist. */
function wagerTo(state: HandState, player: HandPlayer, to: number): void {
  const amount = to - player.streetBet;
  const previousBet = state.currentBet;
  moveChips(player, amount, true);
  if (to > previousBet) {
    const increase = to - previousBet;
    if (increase >= state.minRaise) state.minRaise = increase;
    state.currentBet = to;
    record(state, player, previousBet === 0 ? 'bet' : 'raise', amount);
  } else {
    record(state, player, 'call', amount);
  }
}

function needsToAct(state: HandState, p: HandPlayer): boolean {
  return p.status === 'active' && (!p.hasActed || p.streetBet < state.currentBet);
}

function bettingRoundComplete(state: HandState): boolean {
  const actors = state.players.filter((p) => p.status === 'active');
  if (actors.length === 1) {
    // Einziger handlungsfähiger Spieler, dem niemand mehr antworten kann: fertig, sobald er
    // nichts mehr gegen einen tatsächlichen Einsatz zu callen hat (z. B. Big Blind All-in für weniger).
    const [only] = actors as [HandPlayer];
    const highestOther = Math.max(0, ...state.players.filter((p) => p.status === 'allIn').map((p) => p.streetBet));
    if (only.streetBet >= highestOther) return true;
  }
  return !state.players.some((p) => needsToAct(state, p));
}

/** Nach einer Aktion bzw. nach den Blinds: nächsten Spieler bestimmen oder Straße/Hand beenden. */
function proceed(state: HandState, lastSeat: number): void {
  const remaining = state.players.filter((p) => p.status !== 'folded');
  if (remaining.length === 1) {
    const [winner] = remaining as [HandPlayer];
    const pot = potTotal(state);
    winner.stack += pot;
    state.payouts = [{ playerId: winner.id, amount: pot }];
    state.phase = 'complete';
    state.toActId = null;
    return;
  }
  if (!bettingRoundComplete(state)) {
    state.toActId = nextToAct(state, lastSeat);
    return;
  }
  // Straße fertig: weiter austeilen, bis jemand handeln muss oder der River durch ist.
  for (;;) {
    if (state.street === 'river') {
      state.phase = 'showdown'; // Übergabe an WP-007 (Pots, Showdown)
      state.toActId = null;
      return;
    }
    dealNextStreet(state);
    if (!bettingRoundComplete(state)) {
      state.toActId = nextToAct(state, state.buttonSeat);
      return;
    }
  }
}

function nextToAct(state: HandState, afterSeat: number): string {
  const next = clockwiseFrom(state.players, afterSeat).find((p) => needsToAct(state, p));
  if (next === undefined) throw new Error('Interner Fehler: niemand am Zug, obwohl die Setzrunde offen ist');
  return next.id;
}

const NEXT_STREET: Record<Exclude<Street, 'river'>, { street: Street; cards: number }> = {
  preflop: { street: 'flop', cards: 3 },
  flop: { street: 'turn', cards: 1 },
  turn: { street: 'river', cards: 1 },
};

/** Eine Karte verbrennen, Board-Karten aufdecken, Straßeneinsätze zurücksetzen. */
function dealNextStreet(state: HandState): void {
  if (state.street === 'river') return;
  const { street, cards } = NEXT_STREET[state.street];
  state.burned.push(drawCard(state));
  for (let i = 0; i < cards; i++) state.board.push(drawCard(state));
  state.street = street;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  for (const p of state.players) {
    p.streetBet = 0;
    p.hasActed = false;
  }
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function defaultBlindSeats(
  sorted: readonly StartHandPlayer[],
  buttonSeat: number,
): { smallBlindSeat: number; bigBlindSeat: number } {
  const order = clockwiseFrom(sorted, buttonSeat);
  const buttonOccupied = sorted.some((p) => p.seat === buttonSeat);
  if (sorted.length === 2 && buttonOccupied) {
    // Heads-up: Button = Small Blind, der andere ist Big Blind.
    return { smallBlindSeat: buttonSeat, bigBlindSeat: (order[0] as StartHandPlayer).seat };
  }
  return { smallBlindSeat: (order[0] as StartHandPlayer).seat, bigBlindSeat: (order[1] as StartHandPlayer).seat };
}

/** Spieler im Uhrzeigersinn, beginnend mit dem ersten Sitz links von `seat` (`seat` selbst zuletzt). */
function clockwiseFrom<T extends { seat: number }>(sortedBySeat: readonly T[], seat: number): T[] {
  const start = sortedBySeat.findIndex((p) => p.seat > seat);
  if (start <= 0) return [...sortedBySeat];
  return [...sortedBySeat.slice(start), ...sortedBySeat.slice(0, start)];
}

function postBlind(state: HandState, player: HandPlayer, blind: number, type: 'smallBlind' | 'bigBlind'): void {
  const amount = Math.min(blind, player.stack);
  moveChips(player, amount, true);
  record(state, player, type, amount);
}

function moveChips(player: HandPlayer, amount: number, countsForStreet: boolean): void {
  player.stack -= amount;
  player.totalBet += amount;
  if (countsForStreet) player.streetBet += amount;
  if (player.stack === 0 && player.status === 'active') player.status = 'allIn';
}

function record(state: HandState, player: HandPlayer, type: HandEvent['type'], amount: number): void {
  state.log.push({
    street: state.street,
    playerId: player.id,
    type,
    amount,
    to: player.streetBet,
    allIn: amount > 0 && player.stack === 0,
  });
}

function drawCard(state: HandState): Card {
  const card = state.deck.shift();
  if (card === undefined) throw new Error('Interner Fehler: Deck leer');
  return card;
}

function playerAtSeat(state: HandState, seat: number): HandPlayer {
  const p = state.players.find((x) => x.seat === seat);
  if (p === undefined) throw new Error(`Interner Fehler: Sitz ${String(seat)} unbesetzt`);
  return p;
}

function playerById(state: HandState, id: string): HandPlayer {
  const p = state.players.find((x) => x.id === id);
  if (p === undefined) throw new Error(`Interner Fehler: Spieler ${id} fehlt`);
  return p;
}

function cloneState(state: HandState): HandState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, holeCards: [...p.holeCards] })),
    deck: [...state.deck],
    burned: [...state.burned],
    board: [...state.board],
    log: state.log.map((e) => ({ ...e })),
    payouts: state.payouts === null ? null : state.payouts.map((x) => ({ ...x })),
  };
}

function fail(code: HandErrorCode, message: string): { ok: false; error: HandError } {
  return { ok: false, error: { code, message } };
}

function checkRange(label: string, amount: number, min: number, max: number): HandError | null {
  if (amount < min) {
    return {
      code: 'AMOUNT_TOO_SMALL',
      message: `${label} auf ${String(amount)} zu klein, mindestens ${String(min)} (für weniger: allIn)`,
    };
  }
  if (amount > max) {
    return { code: 'AMOUNT_TOO_LARGE', message: `${label} auf ${String(amount)} zu groß, höchstens ${String(max)}` };
  }
  return null;
}

function describe(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** Laufzeitprüfung, weil Aktionen später aus Client-Nachrichten (JSON) kommen. */
function validateActionShape(action: unknown): string | null {
  if (typeof action !== 'object' || action === null) return 'Aktion muss ein Objekt sein';
  const { type, amount } = action as { type?: unknown; amount?: unknown };
  switch (type) {
    case 'fold':
    case 'check':
    case 'call':
    case 'allIn':
      return null;
    case 'bet':
    case 'raise':
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
        return `${type}: amount muss eine positive ganze Zahl sein (Gesamteinsatz der Straße), war ${describe(amount)}`;
      }
      return null;
    default:
      return `Unbekannte Aktion ${describe(type)} (erlaubt: fold, check, call, bet, raise, allIn)`;
  }
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const isNonNegativeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function validateSetup(o: StartHandOptions): string | null {
  const n = o.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    return `${String(MIN_PLAYERS)}–${String(MAX_PLAYERS)} Spieler nötig, waren ${String(n)}`;
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const p of o.players) {
    if (typeof p.id !== 'string' || p.id === '') return 'Spieler-ID muss ein nicht-leerer String sein';
    if (ids.has(p.id)) return `Spieler-ID doppelt: ${p.id}`;
    ids.add(p.id);
    if (!isNonNegativeInt(p.seat)) return `Sitz von ${p.id} muss eine nicht-negative ganze Zahl sein`;
    if (seats.has(p.seat)) return `Sitz doppelt: ${String(p.seat)}`;
    seats.add(p.seat);
    if (!isPositiveInt(p.stack)) return `Stack von ${p.id} muss eine positive ganze Zahl sein`;
  }
  if (!isNonNegativeInt(o.buttonSeat)) return 'buttonSeat muss eine nicht-negative ganze Zahl sein';
  if (!isPositiveInt(o.smallBlind)) return 'smallBlind muss eine positive ganze Zahl sein';
  if (!isPositiveInt(o.bigBlind) || o.bigBlind < o.smallBlind) {
    return 'bigBlind muss eine ganze Zahl ≥ smallBlind sein';
  }
  if (o.ante !== undefined && !isNonNegativeInt(o.ante)) return 'ante muss eine nicht-negative ganze Zahl sein';
  if (o.blinds !== undefined) {
    const { smallBlindSeat, bigBlindSeat } = o.blinds;
    if (!seats.has(bigBlindSeat)) return `bigBlindSeat ${String(bigBlindSeat)} ist nicht besetzt`;
    if (smallBlindSeat !== null) {
      if (!seats.has(smallBlindSeat)) return `smallBlindSeat ${String(smallBlindSeat)} ist nicht besetzt`;
      if (smallBlindSeat === bigBlindSeat) return 'smallBlindSeat und bigBlindSeat müssen verschieden sein';
    }
  }
  if (o.deck !== undefined) {
    const needed = 2 * n + 8; // Hole Cards + 5 Board + 3 Burn
    if (!o.deck.every(isCard) || new Set(o.deck).size !== o.deck.length) {
      return 'deck muss aus gültigen, verschiedenen Karten bestehen';
    }
    if (o.deck.length < needed) return `deck braucht mindestens ${String(needed)} Karten`;
  }
  return null;
}
