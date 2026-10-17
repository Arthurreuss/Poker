// Feier nach der Hand (WP-040): Schriftzug, Karten, Konfetti-Wechsel und Münz-Stufen aus echten Server-Sichten.
import { HAND_CATEGORY_NAMES } from '@poker/engine';
import { describe, expect, it } from 'vitest';
import { CONFETTI_COUNT, coinTier, handCelebration, handTitle } from './celebration';
import { act, serverView, startGame, toAct, type Game } from './test/fixtures';

function playToShowdown(game: Game, aggressive = false): void {
  while (game.round.hand?.phase === 'betting') {
    const legal = serverView(game, toAct(game)).round?.hand?.legalActions;
    const has = (t: string) => legal?.actions.some((a) => a.type === t) ?? false;
    if (aggressive && has('allIn')) act(game, { type: 'allIn' });
    else act(game, has('check') ? { type: 'check' } : { type: 'call' });
  }
}

describe('handCelebration', () => {
  it('ohne beendete Hand: null', () => {
    expect(handCelebration(serverView(startGame(), 1))).toBeNull();
  });

  it('Fold-out: Gewinner als Schriftzug, ohne Karten, Betrag ohne zurückgegebenen Überschuss', () => {
    const game = startGame();
    act(game, { type: 'fold' });
    act(game, { type: 'fold' });
    const view = serverView(game, 1);
    const hand = view.round?.hand;
    const winner = view.seats.find((s) => String(s.user.id) === hand?.payouts?.[0]?.playerId)?.user.username;
    const c = handCelebration(view);
    expect(c?.title).toBe(`${winner ?? '?'} gewinnt`);
    // Big Blind gewinnt den Small Blind und bekommt den eigenen Überschuss nur zurück.
    expect(c?.detail).toBe(`Alle anderen haben gefoldet · ${String((hand?.smallBlind ?? 0) * 2)}`);
    expect(c?.cards).toBeUndefined();
    expect(c?.coins).toBe(0);
  });

  it('Showdown: Name der Gewinnerhand und deren fünf Karten', () => {
    const game = startGame();
    playToShowdown(game);
    const view = serverView(game, 1);
    const pot = view.round?.hand?.showdown?.pots[0];
    const c = handCelebration(view);
    expect(Object.values(HAND_CATEGORY_NAMES)).toContain(c?.title);
    expect(c?.cards).toEqual(pot?.winningHand?.cards);
    expect(c?.cards).toHaveLength(5);
    expect(c?.detail).toMatch(/gewinnt|teilen sich/);
  });

  it('alle All-in: der ganze Tisch im Pot → alle drei Münz-Animationen', () => {
    const game = startGame();
    playToShowdown(game, true);
    expect(handCelebration(serverView(game, 1))?.coins).toBe(3);
  });

  it('Konfetti wechselt mit jeder Hand und ist für alle Zuschauer gleich', () => {
    const game = startGame();
    act(game, { type: 'fold' });
    act(game, { type: 'fold' });
    const a = handCelebration(serverView(game, 1));
    const b = handCelebration(serverView(game, 2));
    expect(a?.confetti).toBe(b?.confetti);
    expect(a?.confetti).toBe((a?.handNumber ?? 0) % CONFETTI_COUNT);
  });
});

describe('coinTier', () => {
  it.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [249, 1],
    [250, 2],
    [499, 2],
    [500, 3],
    [1000, 3],
  ])('%i von 1.000 Chips → Stufe %i', (won, tier) => {
    expect(coinTier(won, 1000)).toBe(tier);
  });

  it('ohne Chips am Tisch keine Münzen', () => {
    expect(coinTier(100, 0)).toBe(0);
  });
});

describe('handTitle', () => {
  it('Straight Flush mit Ass und König ist ein Royal Flush, mit Ass als Fünf nicht', () => {
    expect(handTitle('straight-flush', ['Ah', 'Kh', 'Qh', 'Jh', 'Th'])).toBe('Royal Flush');
    expect(handTitle('straight-flush', ['5h', '4h', '3h', '2h', 'Ah'])).toBe('Straight Flush');
    expect(handTitle('full-house', ['Ks', 'Kh', 'Kd', '2c', '2d'])).toBe('Full House');
  });
});
