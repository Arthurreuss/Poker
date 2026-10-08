/**
 * Pots und Showdown (WP-007): Main/Side Pots aus `totalBet`, Rückgabe nicht gecallter Beträge,
 * Handvergleich je Pot, Split mit ungeraden Chips, Zeigereihenfolge.
 * Regeln und Auslegungen: ARCHITECTURE.md, Abschnitt „Engine: Pots und Showdown“.
 */
import type { Card } from './cards';
import { determineWinners, evaluateHand, type HandResult } from './hand-eval';
import type { HandPlayer, HandState, Payout, PotAward, PotBreakdown, ShowdownHand, ShowdownReveal } from './hand-state';
import { clockwiseFrom } from './seats';

/** Was `calculatePots` von einem Spieler braucht. */
export type PotContributor = Pick<HandPlayer, 'id' | 'totalBet' | 'status'>;

/**
 * Bildet Main Pot und Side Pots aus den Gesamteinsätzen (`totalBet`) aller Spieler.
 *
 * - Der Teil des höchsten Einsatzes, den niemand erreicht hat, ist nicht gecallt (`uncalled`) und
 *   geht an den Einzahler zurück.
 * - Grenzen der Pots sind die Einsatzhöhen der nicht gefoldeten Spieler. Gefoldete Einsätze bleiben
 *   in den Pots (tote Chips), gefoldete Spieler sind aber nicht berechtigt.
 * - `eligibleIds` folgt der Eingabereihenfolge (im `HandState`: nach Sitz).
 *
 * Während einer laufenden Setzrunde ist `uncalled` nur der Stand jetzt (der Einsatz kann noch gecallt werden).
 */
export function calculatePots(players: readonly PotContributor[]): PotBreakdown {
  const live = players.filter((p) => p.status !== 'folded');

  // Nicht gecallter Überschuss: höchster Einsatz minus zweithöchster (über alle Spieler, auch gefoldete).
  let uncalled: Payout | null = null;
  const top = [...players].sort((a, b) => b.totalBet - a.totalBet);
  const [first, second] = top;
  if (first !== undefined && first.status !== 'folded') {
    const excess = first.totalBet - (second?.totalBet ?? 0);
    if (excess > 0) uncalled = { playerId: first.id, amount: excess };
  }
  const effective = (p: PotContributor): number =>
    uncalled !== null && p.id === uncalled.playerId ? p.totalBet - uncalled.amount : p.totalBet;

  const levels = [...new Set(live.map(effective).filter((bet) => bet > 0))].sort((a, b) => a - b);
  const pots: { amount: number; eligibleIds: string[] }[] = [];
  let previous = 0;
  for (const level of levels) {
    const amount = players.reduce(
      (sum, p) => sum + Math.min(effective(p), level) - Math.min(effective(p), previous),
      0,
    );
    pots.push({ amount, eligibleIds: live.filter((p) => effective(p) >= level).map((p) => p.id) });
    previous = level;
  }

  // Gefoldete Einsätze oberhalb des höchsten nicht gefoldeten Einsatzes (im Spielverlauf nicht
  // erreichbar) bleiben im obersten Pot, damit nie Chips verloren gehen.
  const total = players.reduce((sum, p) => sum + effective(p), 0);
  const assigned = pots.reduce((sum, pot) => sum + pot.amount, 0);
  const rest = total - assigned;
  if (rest > 0) {
    const last = pots.at(-1);
    if (last === undefined) pots.push({ amount: rest, eligibleIds: [] });
    else last.amount += rest;
  }
  return { pots, uncalled };
}

/**
 * Löst den Showdown auf (wird von `applyAction`/`startHand` aufgerufen, sobald nach dem River
 * mindestens zwei Spieler übrig sind). Verändert `state` (eine frische Kopie) und setzt
 * `payouts`, `showdown`, die Stacks und `phase = 'complete'`.
 */
export function resolveShowdown(state: HandState): void {
  const { pots, uncalled } = calculatePots(state.players);
  const live = state.players.filter((p) => p.status !== 'folded');
  const cardsOf = new Map(live.map((p) => [p.id, [...p.holeCards, ...state.board]]));
  const hands = new Map(live.map((p) => [p.id, toShowdownHand(evaluateHand(cardsOf.get(p.id) ?? []))]));
  const handOf = (id: string): ShowdownHand => {
    const hand = hands.get(id);
    if (hand === undefined) throw new Error(`Interner Fehler: keine Hand für ${id}`);
    return hand;
  };

  // Vergabereihenfolge für ungerade Chips: ab dem ersten Sitz links vom Button (TDA).
  const oddChipOrder = clockwiseFrom(state.players, state.buttonSeat).map((p) => p.id);

  const awards: PotAward[] = pots.map((pot) => {
    const contenders = oddChipOrder.filter((id) => pot.eligibleIds.includes(id));
    if (contenders.length <= 1) {
      // Nur ein Berechtigter: Pot ohne Handvergleich. (Kein Berechtigter ist im Spielverlauf unmöglich.)
      const shares = contenders.map((id) => ({ playerId: id, amount: pot.amount }));
      return { ...pot, winnerIds: contenders, winningHand: null, shares };
    }
    const result = determineWinners(contenders.map((id) => ({ id, cards: cardsOf.get(id) ?? [] })));
    return {
      ...pot,
      winnerIds: result.winners,
      winningHand: toShowdownHand(result.winningHand),
      shares: splitPot(pot.amount, result.winners),
    };
  });

  // Auszahlungen je Spieler (nach Sitz), inkl. nicht gecalltem Überschuss.
  const won = new Map<string, number>();
  const add = (payout: Payout): void => {
    won.set(payout.playerId, (won.get(payout.playerId) ?? 0) + payout.amount);
  };
  if (uncalled !== null) add(uncalled);
  for (const award of awards) award.shares.forEach(add);
  const payouts: Payout[] = [];
  for (const p of state.players) {
    const amount = won.get(p.id) ?? 0;
    if (amount > 0) {
      p.stack += amount;
      payouts.push({ playerId: p.id, amount });
    }
  }

  const allHandsShown = live.some((p) => p.status === 'allIn');
  state.payouts = payouts;
  state.showdown = {
    uncalled,
    pots: awards,
    reveals: reveals(state, awards, handOf, allHandsShown),
    allHandsShown,
  };
  state.phase = 'complete';
  state.toActId = null;
}

/** Gleichmäßig teilen; ungerade Chips einzeln an die Gewinner in Reihenfolge (ab links vom Button). */
function splitPot(amount: number, winnerIds: readonly string[]): Payout[] {
  const base = Math.floor(amount / winnerIds.length);
  const oddChips = amount - base * winnerIds.length;
  return winnerIds.map((playerId, i) => ({ playerId, amount: base + (i < oddChips ? 1 : 0) }));
}

/**
 * Zeigereihenfolge (TDA): Hat es auf dem River einen Bet/Raise gegeben, zeigt der letzte Aggressor
 * zuerst, sonst der erste nicht gefoldete Spieler links vom Button; danach im Uhrzeigersinn.
 * Zeigen müssen: alle in einer All-in-Situation, sonst wer in einem umkämpften Pot mindestens so gut
 * ist wie die bisher gezeigten Hände dieses Pots (der Erste immer). Alle anderen dürfen mucken.
 */
function reveals(
  state: HandState,
  awards: readonly PotAward[],
  handOf: (id: string) => ShowdownHand,
  allHandsShown: boolean,
): ShowdownReveal[] {
  const live = state.players.filter((p) => p.status !== 'folded');
  const lastAggressor = state.log.findLast(
    (e) => e.street === 'river' && (e.type === 'bet' || e.type === 'raise'),
  )?.playerId;
  const aggressor = live.find((p) => p.id === lastAggressor);
  const order =
    aggressor === undefined
      ? clockwiseFrom(live, state.buttonSeat)
      : [aggressor, ...clockwiseFrom(live, aggressor.seat).filter((p) => p.id !== aggressor.id)];

  const contested = awards.filter((pot) => pot.eligibleIds.length >= 2);
  const bestShown = new Map<PotAward, number>();
  return order.map((p) => {
    const hand = handOf(p.id);
    let mustShow = allHandsShown;
    for (const pot of contested) {
      if (!pot.eligibleIds.includes(p.id)) continue;
      const best = bestShown.get(pot);
      if (best === undefined || hand.value >= best) {
        mustShow = true;
        bestShown.set(pot, Math.max(best ?? hand.value, hand.value));
      }
    }
    return { playerId: p.id, shownCards: mustShow ? [...p.holeCards] : null, hand };
  });
}

function toShowdownHand(hand: HandResult): ShowdownHand {
  const cards: Card[] = [...hand.cards];
  return { category: hand.category, value: hand.value, cards, description: hand.description };
}
