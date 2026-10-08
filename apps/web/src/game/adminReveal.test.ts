import { describe, expect, it } from 'vitest';
import type { AdminCardsMessage } from '@poker/engine/protocol';
import { clearPending, EMPTY_REVEAL, receiveRevealedCards, syncReveal, toggleReveal } from './adminReveal';
import { act, serverView, startGame } from './test/fixtures';

const cardsMsg = (handNumber: number, seat: number): AdminCardsMessage => ({
  type: 'admin.cards',
  requestId: null,
  tableId: 42,
  handNumber,
  seat,
  cards: ['As', 'Kd'],
});

describe('adminReveal (WP-033)', () => {
  it('erstes Umdrehen fragt an, Antwort deckt auf; zurück und wieder ohne Anfrage', () => {
    const game = startGame();
    let state = syncReveal(EMPTY_REVEAL, serverView(game, 1));
    expect(state.handNumber).toBe(1);

    let r = toggleReveal(state, 2);
    expect(r.request).toBe(true);
    state = receiveRevealedCards(r.state, cardsMsg(1, 2));
    expect([...state.faceUp]).toEqual([2]);
    expect(state.cards.get(2)).toEqual(['As', 'Kd']);

    r = toggleReveal(state, 2);
    expect(r.request).toBe(false);
    expect(r.state.faceUp.size).toBe(0);
    r = toggleReveal(r.state, 2);
    expect(r.request).toBe(false);
    expect([...r.state.faceUp]).toEqual([2]);
  });

  it('Hand endet oder neue Hand → alles vergessen', () => {
    const game = startGame(2);
    let state = syncReveal(EMPTY_REVEAL, serverView(game, 1));
    state = receiveRevealedCards(toggleReveal(state, 1).state, cardsMsg(1, 1));
    expect(state.faceUp.size).toBe(1);
    expect(syncReveal(state, serverView(game, 1))).toBe(state); // gleiche Hand: unverändert
    act(game, { type: 'fold' }); // Hand vorbei
    const after = syncReveal(state, serverView(game, 1));
    expect(after).toEqual({ ...EMPTY_REVEAL, handNumber: null });
    expect(toggleReveal(after, 1).request).toBe(false);
  });

  it('Antwort für eine andere Hand wird ignoriert; Fehler verwirft offene Anfragen', () => {
    const game = startGame();
    const state = toggleReveal(syncReveal(EMPTY_REVEAL, serverView(game, 1)), 2).state;
    expect(receiveRevealedCards(state, cardsMsg(7, 2))).toBe(state);
    expect(clearPending(state).pending.size).toBe(0);
  });

  it('erneuter Tipp vor der Antwort nimmt den Wunsch zurück; Karten werden trotzdem gemerkt', () => {
    const game = startGame();
    let state = toggleReveal(syncReveal(EMPTY_REVEAL, serverView(game, 1)), 2).state;
    const r = toggleReveal(state, 2);
    expect(r.request).toBe(false);
    state = receiveRevealedCards(r.state, cardsMsg(1, 2));
    expect(state.faceUp.size).toBe(0);
    expect(toggleReveal(state, 2)).toMatchObject({ request: false });
  });
});
