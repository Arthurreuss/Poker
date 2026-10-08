import type { TableView as ServerTableView } from '@poker/engine/protocol';
import { describe, expect, it } from 'vitest';
import type { PlayerSeatView, SeatView } from '../table/types';
import { heroHandContext, toTableView } from './adapter';
import { act, NOW, serverView, startGame, toAct, type Game } from './test/fixtures';

function player(seat: SeatView | undefined): PlayerSeatView {
  if (seat?.kind !== 'player') throw new Error('kein Spieler');
  return seat;
}

function hand(view: ServerTableView) {
  const h = view.round?.hand;
  if (h === null || h === undefined) throw new Error('keine Hand');
  return h;
}

/** Wer am Zug ist, checkt oder callt – bis die Hand vorbei ist. */
function checkDown(game: Game) {
  while (game.round.hand?.phase === 'betting') {
    const legal = hand(serverView(game, toAct(game))).legalActions;
    act(game, legal?.actions.some((a) => a.type === 'check') ? { type: 'check' } : { type: 'call' });
  }
}

describe('toTableView – vor dem Start', () => {
  it('Sitze aus der Tischbelegung, Startstack, Blinds des ersten Levels', () => {
    const view = toTableView(serverView(null, 1));
    expect(view.seats).toHaveLength(9);
    expect(view.seats.filter((s) => s.kind === 'player')).toHaveLength(3);
    expect(player(view.seats[1])).toMatchObject({
      name: 'ben',
      stack: 1500,
      bet: 0,
      status: 'active',
      holeCards: { kind: 'none' },
    });
    expect(view.heroSeat).toBe(0);
    expect(view.toActSeat).toBeNull();
    expect(view.board).toEqual([]);
    expect(view.pots).toEqual([]);
    expect(view.blinds.big).toBeGreaterThan(0);
  });

  it('Zuschauer: kein eigener Sitz', () => {
    expect(toTableView(serverView(null, 99)).heroSeat).toBeNull();
  });
});

describe('toTableView – laufende Hand', () => {
  it('eigene Karten sichtbar, fremde verdeckt; Blinds als Einsätze vor den Sitzen, noch kein Pot', () => {
    const game = startGame();
    const server = serverView(game, 1);
    const h = hand(server);
    const view = toTableView(server);
    const hero = player(view.seats[0]);
    expect(hero.holeCards.kind).toBe('visible');
    expect(player(view.seats[1]).holeCards).toEqual({ kind: 'hidden' });
    expect(player(view.seats[2]).holeCards).toEqual({ kind: 'hidden' });
    expect(view.buttonSeat).toBe(h.buttonSeat);
    expect(view.bigBlindSeat).toBe(h.bigBlindSeat);
    expect(player(view.seats[h.bigBlindSeat]).bet).toBe(h.bigBlind);
    expect(view.blinds).toMatchObject({ small: h.smallBlind, big: h.bigBlind });
    expect(view.toActSeat).toBe(toAct(game) - 1);
    expect(view.pots).toEqual([]);
  });

  it('nach der ersten Setzrunde: Einsätze im Pot, Board liegt, Fold ohne Karten', () => {
    const game = startGame();
    const bb = hand(serverView(game, 1)).bigBlind;
    const folder = toAct(game);
    act(game, { type: 'fold' });
    checkDownStreet(game);
    const view = toTableView(serverView(game, 1));
    expect(view.board).toHaveLength(3);
    expect(view.pots).toEqual([{ amount: 2 * bb }]);
    for (const s of view.seats) if (s.kind === 'player') expect(s.bet).toBe(0);
    expect(player(view.seats[folder - 1])).toMatchObject({ status: 'folded', holeCards: { kind: 'none' } });
  });

  it('Showdown: aufgedeckte Karten, kein Pot mehr vor dem Board, keine Einsätze', () => {
    const game = startGame();
    checkDown(game);
    const server = serverView(game, 1);
    expect(hand(server).phase).toBe('complete');
    const view = toTableView(server);
    expect(view.toActSeat).toBeNull();
    expect(view.pots).toEqual([]);
    expect(view.board).toHaveLength(5);
    const kinds = view.seats.flatMap((s) => (s.kind === 'player' ? [s.holeCards.kind] : []));
    expect(kinds[0]).toBe('visible');
    // Wer zeigen musste, zeigt; wer muckt, hat keine Karten mehr – verdeckt bleibt niemand.
    expect(kinds.slice(1).every((k) => k === 'shown' || k === 'none')).toBe(true);
    expect(kinds).toContain('shown');
  });

  it('Timer nur für den Sitz am Zug', () => {
    const game = startGame();
    const server = serverView(game, 1);
    const seat = toAct(game) - 1;
    const clock = { seat, startedMs: NOW, turnEndsMs: NOW + 20_000, deadlineMs: NOW + 20_000 };
    expect(toTableView(server, { turnClock: clock, nowMs: NOW + 5_000 }).timeRemaining).toBeCloseTo(0.75);
    const other = toTableView(server, { turnClock: { ...clock, seat: (seat + 1) % 3 }, nowMs: NOW });
    expect(other.timeRemaining).toBeUndefined();
    const bank = toTableView(server, {
      turnClock: { ...clock, deadlineMs: NOW + 50_000 },
      nowMs: NOW + 30_000,
    });
    expect(bank.timeBankSeconds).toBe(20);
  });

  it('ausgeschiedene Spieler (Platz vergeben, nicht in der Hand)', () => {
    const game = startGame();
    const server = serverView(game, 1);
    const round = server.round;
    if (round === null) throw new Error();
    const h = hand(server);
    const eliminated: ServerTableView = {
      ...server,
      round: {
        ...round,
        players: round.players.map((p) => (p.id === '3' ? { ...p, stack: 0, placement: 3, eliminatedInHand: 0 } : p)),
        hand: { ...h, players: h.players.filter((p) => p.playerId !== '3') },
      },
    };
    expect(player(toTableView(eliminated).seats[2])).toMatchObject({
      status: 'eliminated',
      stack: 0,
      holeCards: { kind: 'none' },
    });
  });
});

/** Nur die laufende Straße zu Ende spielen. */
function checkDownStreet(game: Game) {
  const street = game.round.hand?.street;
  while (game.round.hand?.phase === 'betting' && game.round.hand.street === street) {
    const legal = hand(serverView(game, toAct(game))).legalActions;
    act(game, legal?.actions.some((a) => a.type === 'check') ? { type: 'check' } : { type: 'call' });
  }
}

describe('heroHandContext', () => {
  it('am Zug: erlaubte Aktionen vom Server', () => {
    const game = startGame();
    const ctx = heroHandContext(serverView(game, toAct(game)));
    expect(ctx?.legal?.actions.map((a) => a.type)).toContain('fold');
    expect(ctx?.canAct).toBe(true);
  });

  it('nicht am Zug: keine Aktionen, aber offener Betrag für Vorab-Aktionen', () => {
    const game = startGame();
    const waiting = [1, 2, 3].find((id) => id !== toAct(game)) ?? 0;
    const server = serverView(game, waiting);
    const ctx = heroHandContext(server);
    const h = hand(server);
    const me = h.players.find((p) => p.playerId === String(waiting));
    expect(ctx).toMatchObject({ legal: null, canAct: true, toCall: h.currentBet - (me?.streetBet ?? 0), pot: h.pot });
  });

  it('Zuschauer und Hand vorbei: kein Kontext', () => {
    const game = startGame();
    expect(heroHandContext(serverView(game, null))).toBeNull();
    checkDown(game);
    expect(heroHandContext(serverView(game, 1))).toBeNull();
  });
});

describe('toTableView – Gewinner und Teil-Aufdecken (WP-031)', () => {
  /** Heads-up: beide All-in preflop → Runout bis zum River, Hand fertig. */
  function allInHeadsUp(): Game {
    const game = startGame(2);
    act(game, { type: 'allIn' });
    act(game, { type: 'call' });
    return game;
  }

  it('fertige Hand: Gewinner-Sitze, Gewinnerhand und Handnummer', () => {
    const game = allInHeadsUp();
    const server = serverView(game, 1);
    const h = hand(server);
    expect(h.phase).toBe('complete');
    const view = toTableView(server);
    const winners = new Set(h.showdown?.pots.flatMap((p) => p.winnerIds));
    expect(view.winnerSeats).toEqual(h.players.filter((p) => winners.has(p.playerId)).map((p) => p.seat));
    expect(view.winningCards).toEqual(h.showdown?.pots[0]?.winningHand?.cards);
    expect(view.handNumber).toBe(1);
    expect(view.board).toHaveLength(5);
  });

  it('Ergebnis zurückgehalten: Board gekürzt, Stacks vor der Auszahlung, ganzer Pot, keine Gewinner', () => {
    const game = allInHeadsUp();
    const server = serverView(game, 1);
    const view = toTableView(server, { reveal: { board: 3, result: false } });
    expect(view.board).toEqual(hand(server).board.slice(0, 3));
    expect(view.winnerSeats).toBeUndefined();
    expect(view.winningCards).toBeUndefined();
    expect(view.pots).toEqual([{ amount: 3000 }]);
    for (const seat of view.seats.filter((s) => s.kind === 'player')) expect(player(seat).stack).toBe(0);
  });

  it('Fold-out: Gewinner aus den Auszahlungen, keine Gewinnerhand', () => {
    const game = startGame(2);
    act(game, { type: 'fold' });
    const view = toTableView(serverView(game, 1));
    expect(view.winnerSeats).toHaveLength(1);
    expect(view.winningCards).toBeUndefined();
  });

  it('laufende Hand: keine Gewinner', () => {
    const view = toTableView(serverView(startGame(), 1));
    expect(view.winnerSeats).toBeUndefined();
  });
});
