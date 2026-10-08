// Spielstil-Statistiken (WP-019): reine Berechnung ohne DB. Definitionen und Begründungen:
// docs/ARCHITECTURE.md, Abschnitt „Statistiken“. Welche Hände überhaupt zählen (nur beendete Hände beendeter
// Runden, D-019/D-022), entscheidet die Abfrage in `queries.ts` – hier wird nur je Hand klassifiziert und summiert.
import type { HandActionType, Street } from '../db/types';
import type { HandRecord } from '../history/records';

/** Eigene Aktion eines Spielers in einer Hand (Reihenfolge wie `seq`). */
export interface PlayerAction {
  street: Street;
  action: HandActionType;
  isAutomatic: boolean;
}

/** Was die Statistik von einer Hand aus Sicht eines Spielers braucht. */
export interface PlayerHand {
  /** Alle eigenen Aktionen inkl. Blinds, in Reihenfolge. */
  actions: readonly PlayerAction[];
  /** Anzahl Gemeinschaftskarten am Ende der Hand (0, 3, 4, 5). */
  boardSize: number;
  /** Hand endete im Showdown (`hands.result.showdown`). */
  showdown: boolean;
  /** Spieler hat (mindestens anteilig) einen Pot gewonnen – zurückgegebene, nicht gecallte Einsätze zählen nicht. */
  wonPot: boolean;
}

/** Klassifikation einer Hand für einen Spieler. */
export interface HandFlags {
  /** Erste eigene Nicht-Blind-Aktion war automatisch (Zeitablauf/Trennung): Spieler war nicht da. */
  absent: boolean;
  /** Spieler hat preflop selbst entschieden (Basis für VPIP und PFR). */
  preflopDecision: boolean;
  /** Freiwillig Geld investiert: preflop Call, Bet oder Raise (Blinds zählen nicht). */
  vpip: boolean;
  /** Preflop Bet oder Raise. */
  pfr: boolean;
  /** Flop gesehen: preflop nicht gefoldet und die Hand hat einen Flop (auch per All-in-Run-out). */
  sawFlop: boolean;
  /** Im Showdown, ohne gefoldet zu haben. */
  wentToShowdown: boolean;
  /** Im Showdown einen Pot (auch geteilt) gewonnen. */
  wonAtShowdown: boolean;
}

/** Quote als Zähler/Nenner; Prozent rechnet die Anzeige (Nenner 0 → „–“). */
export interface Rate {
  count: number;
  of: number;
}

export interface HandStats {
  /** Gespielte Hände: alle gewerteten Hände, in denen der Spieler Karten bekam. */
  hands: number;
  vpip: Rate;
  pfr: Rate;
  /** Went to Showdown: Showdowns / gesehene Flops. */
  wtsd: Rate;
  /** Won Money at Showdown: gewonnene Showdowns / Showdowns. */
  wsd: Rate;
}

const BLINDS: ReadonlySet<HandActionType> = new Set(['small_blind', 'big_blind']);
const VOLUNTARY: ReadonlySet<HandActionType> = new Set(['call', 'bet', 'raise']);
const AGGRESSIVE: ReadonlySet<HandActionType> = new Set(['bet', 'raise']);

export function classifyHand(hand: PlayerHand): HandFlags {
  const decisions = hand.actions.filter((a) => !BLINDS.has(a.action));
  const absent = decisions[0]?.isAutomatic ?? false;
  const preflop = decisions.filter((a) => a.street === 'preflop');
  const own = preflop.filter((a) => !a.isAutomatic);
  const foldedPreflop = preflop.some((a) => a.action === 'fold');
  const folded = decisions.some((a) => a.action === 'fold');
  const sawFlop = !foldedPreflop && hand.boardSize >= 3;
  const wentToShowdown = hand.showdown && !folded;
  return {
    absent,
    preflopDecision: !absent && preflop.length > 0,
    vpip: !absent && own.some((a) => VOLUNTARY.has(a.action)),
    pfr: !absent && own.some((a) => AGGRESSIVE.has(a.action)),
    sawFlop,
    wentToShowdown,
    wonAtShowdown: wentToShowdown && hand.wonPot,
  };
}

const rate = (count: number, of: number): Rate => ({ count, of });

/** Summiert die Klassifikation über alle gewerteten Hände eines Spielers. */
export function aggregateHandStats(hands: readonly PlayerHand[]): HandStats {
  let decisions = 0;
  let vpip = 0;
  let pfr = 0;
  let flops = 0;
  let showdowns = 0;
  let won = 0;
  for (const hand of hands) {
    const f = classifyHand(hand);
    if (f.preflopDecision) decisions++;
    if (f.vpip) vpip++;
    if (f.pfr) pfr++;
    // Hände, in denen der Spieler nicht da war, sagen nichts über seinen Spielstil.
    if (f.absent) continue;
    if (f.sawFlop) flops++;
    if (f.wentToShowdown) showdowns++;
    if (f.wonAtShowdown) won++;
  }
  return {
    hands: hands.length,
    vpip: rate(vpip, decisions),
    pfr: rate(pfr, decisions),
    wtsd: rate(showdowns, flops),
    wsd: rate(won, showdowns),
  };
}

/**
 * Sicht eines Spielers auf eine gespeicherte, beendete Hand; `null`, wenn er nicht mitspielte oder die Hand nicht
 * beendet ist. Dieselbe Ableitung macht die SQL-Abfrage (`loadPlayerHands`) – der DB-Test vergleicht beide.
 */
export function playerHandFromRecord(record: HandRecord, userId: number): PlayerHand | null {
  if (record.result === null || !record.players.some((p) => p.userId === userId)) return null;
  return {
    actions: record.actions
      .filter((a) => a.userId === userId)
      .map((a) => ({ street: a.street, action: a.action, isAutomatic: a.isAutomatic })),
    boardSize: record.board.length,
    showdown: record.result.showdown,
    wonPot: record.result.pots.some((p) => p.winnerUserIds.includes(userId)),
  };
}
