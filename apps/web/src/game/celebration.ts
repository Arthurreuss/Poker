// Feier nach einer Hand (WP-040): rein, aus der gefilterten Server-Sicht. Was gezeigt wird, hängt nur von der Hand ab
// (Nummer, Gewinner, Pot) – alle am Tisch sehen dasselbe Konfetti und dieselben Münzen.
import { calculatePots, HAND_CATEGORY_NAMES, type Card } from '@poker/engine';
import type { HandView, TableView as ServerTableView } from '@poker/engine/protocol';
import { formatChips } from '../table/format';
import type { CelebrationView } from '../table/types';

/** Anzahl der Konfetti-Animationen (`table/celebrate/clips.ts`); je Hand die nächste. */
export const CONFETTI_COUNT = 7;

/**
 * Ab diesem Anteil des Pots an allen Chips am Tisch kommt die 1., 2. bzw. 3. Münz-Animation dazu
 * (klein: Münzen fallen, mittel: + Münzstapel, groß: + Münzregen). Unter 10 % nur Konfetti.
 */
export const COIN_TIER_SHARES = [0.1, 0.25, 0.5] as const;

/** Münz-Stufe 0–3 für einen gewonnenen Betrag; `totalChips` = alle Chips der Runde. */
export function coinTier(won: number, totalChips: number): CelebrationView['coins'] {
  if (totalChips <= 0) return 0;
  const share = won / totalChips;
  const [small, medium, large] = COIN_TIER_SHARES;
  if (share >= large) return 3;
  if (share >= medium) return 2;
  if (share >= small) return 1;
  return 0;
}

/** Royal Flush ist in der Engine ein Straight Flush mit Ass als höchster Karte. */
export function handTitle(category: keyof typeof HAND_CATEGORY_NAMES, cards: readonly Card[]): string {
  if (category === 'straight-flush' && cards.some((c) => c.startsWith('A')) && cards.some((c) => c.startsWith('K'))) {
    return 'Royal Flush';
  }
  return HAND_CATEGORY_NAMES[category];
}

function names(ids: readonly string[], server: ServerTableView): string {
  const byId = new Map(server.seats.map((s) => [String(s.user.id), s.user.username]));
  return ids.map((id) => byId.get(id) ?? '?').join(' und ');
}

/** Gewonnene Chips ohne den nicht gecallten Überschuss (der geht nur zurück). */
function wonAmount(hand: HandView): number {
  if (hand.showdown !== null) return hand.showdown.pots.reduce((sum, p) => sum + p.amount, 0);
  const { pots } = calculatePots(hand.players.map((p) => ({ id: p.playerId, status: p.status, totalBet: p.totalBet })));
  return pots.reduce((sum, p) => sum + p.amount, 0);
}

/** Feier für die beendete Hand; `null`, solange keine Hand fertig ist. */
export function handCelebration(server: ServerTableView): CelebrationView | null {
  const hand = server.round?.hand;
  if (hand === null || hand === undefined || hand.phase !== 'complete') return null;
  const totalChips = server.settings.startingStack * (server.round?.players.length ?? 0);
  const won = wonAmount(hand);
  const base = {
    handNumber: hand.handNumber,
    confetti: hand.handNumber % CONFETTI_COUNT,
    coins: coinTier(won, totalChips),
  };

  const main = hand.showdown?.pots.find((p) => p.amount > 0 && p.winningHand !== null);
  if (main?.winningHand !== null && main?.winningHand !== undefined) {
    const winners = main.winnerIds;
    const who = names(winners, server);
    const amount = formatChips(main.amount);
    return {
      ...base,
      title: handTitle(main.winningHand.category, main.winningHand.cards),
      detail: winners.length > 1 ? `Split Pot: ${who} teilen sich ${amount}` : `${who} gewinnt ${amount}`,
      cards: [...main.winningHand.cards],
    };
  }

  const winners = [...new Set((hand.payouts ?? []).map((p) => p.playerId))];
  if (winners.length === 0) return null;
  return {
    ...base,
    title: `${names(winners, server)} gewinnt`,
    detail: `Alle anderen haben gefoldet · ${formatChips(won)}`,
  };
}
