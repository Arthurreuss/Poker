/**
 * Filter „Spielzustand → Sicht eines Empfängers“ (D-003, WP-011). Reine Funktionen; der Server ruft sie
 * für jeden Empfänger einzeln auf. Regeln:
 * - eigene Hole Cards immer, fremde nie vor dem Showdown, im Showdown nur `shownCards` (gemuckte nie),
 * - Deck und verbrannte Karten nie,
 * - Handbewertungen nur für gezeigte (und die eigene) Hand,
 * - `legalActions` nur für den Empfänger, wenn er am Zug ist.
 */
import { legalActions, potTotal } from '../betting';
import type { HandState, ShowdownHand } from '../hand-state';
import { roundBlindLevel, type RoundState } from '../round';
import type { HandPlayerView, HandView, RoundView, ShowdownView } from './messages';

const copyHand = (h: ShowdownHand): ShowdownHand => ({ ...h, cards: [...h.cards] });

/**
 * Sicht auf eine Hand für `viewerId` (Engine-Spieler-ID; `null` = Zuschauer ohne Karten).
 * `handNumber` kommt aus der Runde (die Hand selbst kennt ihre Nummer nicht).
 */
export function toHandView(hand: HandState, handNumber: number, viewerId: string | null): HandView {
  const shown = new Map<string, HandState['players'][number]['holeCards']>();
  if (hand.phase === 'complete' && hand.showdown !== null) {
    for (const r of hand.showdown.reveals) {
      if (r.shownCards !== null) shown.set(r.playerId, r.shownCards);
    }
  }

  const players: HandPlayerView[] = hand.players.map((p) => {
    const cards = p.id === viewerId ? p.holeCards : (shown.get(p.id) ?? null);
    return {
      playerId: p.id,
      seat: p.seat,
      startStack: p.startStack,
      stack: p.stack,
      status: p.status,
      streetBet: p.streetBet,
      totalBet: p.totalBet,
      hasActed: p.hasActed,
      holeCards: cards === null ? null : [...cards],
    };
  });

  let showdown: ShowdownView | null = null;
  if (hand.showdown !== null) {
    const s = hand.showdown;
    showdown = {
      uncalled: s.uncalled === null ? null : { ...s.uncalled },
      pots: s.pots.map((pot) => ({
        amount: pot.amount,
        eligibleIds: [...pot.eligibleIds],
        winnerIds: [...pot.winnerIds],
        winningHand: pot.winningHand === null ? null : copyHand(pot.winningHand),
        shares: pot.shares.map((x) => ({ ...x })),
      })),
      reveals: s.reveals.map((r) => ({
        playerId: r.playerId,
        shownCards: r.shownCards === null ? null : [...r.shownCards],
        hand: r.shownCards !== null || r.playerId === viewerId ? copyHand(r.hand) : null,
      })),
      allHandsShown: s.allHandsShown,
    };
  }

  const legal = viewerId !== null && hand.toActId === viewerId ? legalActions(hand) : null;

  return {
    handNumber,
    actionSeq: hand.log.length,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    buttonSeat: hand.buttonSeat,
    smallBlindSeat: hand.smallBlindSeat,
    bigBlindSeat: hand.bigBlindSeat,
    street: hand.street,
    phase: hand.phase,
    board: [...hand.board],
    toActId: hand.toActId,
    currentBet: hand.currentBet,
    minRaise: hand.minRaise,
    pot: potTotal(hand),
    players,
    log: hand.log.map((e) => ({ ...e })),
    payouts: hand.payouts === null ? null : hand.payouts.map((x) => ({ ...x })),
    showdown,
    legalActions: legal === null ? null : { ...legal, actions: legal.actions.map((a) => ({ ...a })) },
  };
}

/**
 * Sicht auf eine Runde für `viewerId` (`null` = Zuschauer). `nowMs` (Server-Uhr) bestimmt nur die
 * Anzeige des Blind-Levels einer jetzt startenden Hand.
 */
export function toClientView(round: RoundState, viewerId: string | null, nowMs: number): RoundView {
  const level = roundBlindLevel(round, nowMs);
  return {
    phase: round.phase,
    handNumber: round.handNumber,
    blindLevel: {
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      levelIndex: level.levelIndex,
      nextLevelAtMs: level.nextLevelAtMs,
    },
    players: round.players.map((p) => ({ ...p })),
    hand: round.hand === null ? null : toHandView(round.hand, round.handNumber, viewerId),
    standings: round.standings === null ? null : round.standings.map((s) => ({ ...s })),
  };
}
