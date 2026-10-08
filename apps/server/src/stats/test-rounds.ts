// Test-Hilfe (WP-019): komplette Freezeout-Runde mit Zufallsaktionen direkt über die Engine, ohne Game-Server.
import {
  applyRoundAction,
  createSeededRng,
  legalActions,
  startNextHand,
  startRound,
  type Action,
  type HandState,
} from '@poker/engine';

/** Spieler-ID der Engine = String(userId), Sitz = Index. Liefert alle beendeten Hände in Reihenfolge. */
export function playRandomRound(seed: number, userIds: readonly number[], startingStack = 600): HandState[] {
  const rng = createSeededRng(seed);
  const started = startRound(
    {
      startingStack,
      blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      turnTimeSeconds: 20,
      timeBankSeconds: 60,
    },
    userIds.map((id, seat) => ({ id: String(id), seat })),
    rng,
  );
  if (!started.ok) throw new Error(started.error.message);
  let round = started.round;
  const hands: HandState[] = [];
  for (let n = 0; round.phase !== 'finished' && n < 5_000; n++) {
    if (round.phase === 'waiting') {
      const next = startNextHand(round, 0, rng);
      if (!next.ok) throw new Error(next.error.message);
      round = next.round;
    } else if (round.hand !== null) {
      const legal = legalActions(round.hand);
      if (legal === null) throw new Error('niemand am Zug');
      // Meist passiv (Showdowns mit Mucks), sonst zufällig inkl. Fold, Raise, All-in.
      const passive = legal.actions.find((x) => x.type === 'check' || x.type === 'call');
      const a = rng.int(4) > 0 && passive !== undefined ? passive : legal.actions[rng.int(legal.actions.length)];
      if (a === undefined) throw new Error('keine Aktion');
      const action: Action =
        a.type === 'bet' || a.type === 'raise' ? { type: a.type, amount: a.min } : { type: a.type };
      const next = applyRoundAction(round, legal.playerId, action);
      if (!next.ok) throw new Error(next.error.message);
      round = next.round;
    }
    if (round.hand?.phase === 'complete' && hands.at(-1) !== round.hand) hands.push(round.hand);
  }
  if (round.phase !== 'finished') throw new Error('Runde endet nicht');
  return hands;
}
