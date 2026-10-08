// Reine Logik der Aktionsleiste (WP-018): Einsatzgrenzen ausschließlich aus `legalActions` (D-003),
// Schnellwahl-Beträge und Vorab-Aktionen. Unit-getestet in `logic.test.ts`.
import type { Action, LegalAction, LegalActions, Street } from '@poker/engine';

type Of<T extends LegalAction['type']> = Extract<LegalAction, { type: T }>;

function find<T extends LegalAction['type']>(legal: LegalActions, type: T): Of<T> | undefined {
  return legal.actions.find((a): a is Of<T> => a.type === type);
}

/** Bet/Raise-Bereich als Gesamteinsatz der Straße („to“), nur wenn der Server ihn erlaubt. */
export interface WagerRange {
  readonly type: 'bet' | 'raise';
  readonly min: number;
  readonly max: number;
  /** All-in-Betrag („to“), falls `max` ein All-in ist. */
  readonly allInTo: number | null;
}

export interface ActionOptions {
  readonly fold: boolean;
  readonly check: boolean;
  /** Call-Betrag (einzuzahlende Chips) oder `null`. */
  readonly call: number | null;
  /** Call bringt den Spieler All-in (Stack reicht nur dafür). */
  readonly callIsAllIn: boolean;
  readonly wager: WagerRange | null;
  /**
   * All-in, das kein voller Bet/Raise ist (Stack reicht nicht für das Minimum), als eigener Knopf;
   * `amount` = einzuzahlende Chips, `to` = Straßeneinsatz danach.
   */
  readonly shortAllIn: { readonly amount: number; readonly to: number } | null;
}

/** Bedienbare Aktionen – alles, was nicht in `legalActions` steht, ist aus. */
export function actionOptions(legal: LegalActions): ActionOptions {
  const call = find(legal, 'call');
  const allIn = find(legal, 'allIn');
  const bet = find(legal, 'bet');
  const raise = find(legal, 'raise');
  const range = bet ?? raise;
  const wager: WagerRange | null =
    range === undefined
      ? null
      : { type: range.type, min: range.min, max: range.max, allInTo: allIn?.to === range.max ? allIn.to : null };
  const callIsAllIn = call !== undefined && allIn !== undefined && allIn.amount === call.amount;
  // All-in ohne Bet/Raise-Bereich und mehr als ein Call: eigener Knopf (unvollständiger Raise).
  const shortAllIn =
    allIn !== undefined && wager === null && !callIsAllIn && allIn.amount > (call?.amount ?? 0)
      ? { amount: allIn.amount, to: allIn.to }
      : null;
  return {
    fold: find(legal, 'fold') !== undefined,
    check: find(legal, 'check') !== undefined,
    call: call?.amount ?? null,
    callIsAllIn,
    wager,
    shortAllIn,
  };
}

/** Betrag in den erlaubten Bereich holen (ganze Chips). */
export function clampWager(value: number, range: WagerRange): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Aktion für einen gewählten Betrag; der Höchstbetrag als All-in, wenn der Server das so anbietet. */
export function wagerAction(amount: number, range: WagerRange): Action {
  const to = clampWager(amount, range);
  if (range.allInTo !== null && to === range.allInTo) return { type: 'allIn' };
  return { type: range.type, amount: to };
}

export interface PotContext {
  /** Summe aller Einsätze der Hand inkl. laufender Straße. */
  readonly pot: number;
  /** Fehlende Chips zum Mitgehen. */
  readonly toCall: number;
  /** Höchster Einsatz der Straße. */
  readonly currentBet: number;
}

/**
 * Pot-bezogener Einsatz („to“): Bruchteil des Pots nach dem eigenen Call, auf den höchsten Einsatz
 * gerechnet (Pot-Raise = höchster Einsatz + Pot inkl. Call). Auf den erlaubten Bereich geklemmt.
 */
export function potWager(fraction: number, ctx: PotContext, range: WagerRange): number {
  const potAfterCall = ctx.pot + ctx.toCall;
  return clampWager(ctx.currentBet + fraction * potAfterCall, range);
}

export interface Preset {
  readonly label: string;
  readonly value: number;
}

/** Schnellwahl: ½ Pot, Pot, All-in – jeweils in den erlaubten Bereich geklemmt. */
export function wagerPresets(ctx: PotContext, range: WagerRange): Preset[] {
  return [
    { label: '½ Pot', value: potWager(0.5, ctx, range) },
    { label: 'Pot', value: potWager(1, ctx, range) },
    { label: 'All-in', value: range.max },
  ];
}

// ---------------------------------------------------------------------------
// Vorab-Aktionen (wenn man nicht am Zug ist)
// ---------------------------------------------------------------------------

/**
 * - `checkFold`: Check, wenn möglich, sonst Fold – bleibt bis zum Zug gültig
 * - `check`: nur Check – verfällt, sobald jemand setzt
 * - `call`: genau diesen Betrag callen – verfällt, wenn sich der Betrag ändert
 * - `callAny`: jeden Einsatz mitgehen (bzw. checken) – bleibt gültig
 * Alle verfallen mit einer neuen Straße oder Hand.
 */
export type PreActionKind = 'checkFold' | 'check' | 'call' | 'callAny';

export interface PreAction {
  readonly kind: PreActionKind;
  /** Bei `call`: der Betrag zum Zeitpunkt der Wahl. */
  readonly amount: number;
  readonly handNumber: number;
  readonly street: Street;
}

export interface PreActionState {
  readonly handNumber: number;
  readonly street: Street;
  readonly toCall: number;
}

/** Angebotene Vorab-Aktionen für den aktuellen offenen Betrag. */
export function preActionChoices(toCall: number): { kind: PreActionKind; label: string; amount: number }[] {
  return [
    { kind: 'checkFold', label: toCall > 0 ? 'Fold' : 'Check/Fold', amount: 0 },
    toCall > 0 ? { kind: 'call', label: 'Call', amount: toCall } : { kind: 'check', label: 'Check', amount: 0 },
    { kind: 'callAny', label: 'Call any', amount: 0 },
  ];
}

/** Ist die gewählte Vorab-Aktion im aktuellen Zustand noch gültig? */
export function preActionValid(pre: PreAction, now: PreActionState): boolean {
  if (pre.handNumber !== now.handNumber || pre.street !== now.street) return false;
  switch (pre.kind) {
    case 'checkFold':
    case 'callAny':
      return true;
    case 'check':
      return now.toCall === 0;
    case 'call':
      return now.toCall === pre.amount && pre.amount > 0;
  }
}

/** Welche Aktion die Vorab-Wahl jetzt (am Zug) auslöst – nur aus `legalActions`. */
export function resolvePreAction(pre: PreAction, legal: LegalActions): Action | null {
  const o = actionOptions(legal);
  switch (pre.kind) {
    case 'checkFold':
      return o.check ? { type: 'check' } : o.fold ? { type: 'fold' } : null;
    case 'check':
      return o.check ? { type: 'check' } : null;
    case 'call':
      return o.call === pre.amount ? { type: 'call' } : null;
    case 'callAny':
      if (o.check) return { type: 'check' };
      return o.call !== null ? { type: 'call' } : null;
  }
}
