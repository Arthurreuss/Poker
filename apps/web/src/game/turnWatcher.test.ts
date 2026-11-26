// @vitest-environment jsdom
import type { TableView as ServerTableView } from '@poker/engine/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeConnection } from './test/fakeSocket';
import { serverView, startGame, toAct, turnClockFor as clockFor, USERS, type Game } from './test/fixtures';
import { turnKeyOf, TurnWatcher } from './turnWatcher';

function setup(viewer: number) {
  const user = USERS.find((u) => u.id === viewer) ?? USERS[0];
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { ...user } } });
  const turns = new TurnWatcher(fake.connection);
  turns.start();
  fake.connection.start();
  fake.connect();
  const state = (table: ServerTableView) => {
    fake.last().receive({ type: 'table.state', table });
  };
  return { ...fake, turns, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TurnWatcher', () => {
  it('meldet den eigenen Zug mit Tischname und Schlüssel, nicht den der anderen', () => {
    const game = startGame();
    const me = toAct(game);
    const { turns, state } = setup(me);
    state(serverView(game, me, { turnClock: clockFor(game) }));
    const clock = clockFor(game);
    expect(turns.getSnapshot()).toEqual({
      tableId: 42,
      tableName: 'Testtisch',
      key: `42/${String(clock.handNumber)}/${String(clock.actionSeq)}`,
    });

    const other = USERS.find((u) => u.id !== me)?.id ?? 0;
    expect(turnKeyOf(serverView(game, other, { turnClock: clockFor(game) }))).toBeNull();
    expect(turnKeyOf(serverView(game, null, { turnClock: clockFor(game) }))).toBeNull();
  });

  it('hält den Tisch, an dem man sitzt, auch nachdem die Tischseite ihn freigibt', () => {
    const game = startGame();
    const me = toAct(game);
    const { turns, state, connection, last } = setup(me);
    connection.watchTable(42); // Tischseite
    state(serverView(game, me));
    connection.unwatchTable(42); // Tischseite geschlossen
    expect(last().types()).not.toContain('table.unwatch');
    expect(turns.getSnapshot()).toBeNull();
    state(serverView(game, me, { turnClock: clockFor(game) }));
    expect(turns.getSnapshot()?.tableId).toBe(42);
  });

  it('beobachtet den Tisch nach einem Abbruch weiter und vergisst den Zug bis zum neuen Zustand', () => {
    const game = startGame();
    const me = toAct(game);
    const { turns, state, last, connect } = setup(me);
    state(serverView(game, me, { turnClock: clockFor(game) }));
    const listener = vi.fn();
    turns.subscribe(listener);
    last().serverClose(1006);
    expect(turns.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    connect();
    expect(last().sent.at(-1)).toEqual({ type: 'table.join', tableId: 42 });
  });

  it.each([
    // Zwei Spieler: Nutzer 3 sitzt nicht (dieselbe Sicht wie nach dem Aufstehen).
    ['sitzt nicht mehr', (game: Game) => serverView(game, 3)],
    ['Runde beendet', (game: Game, me: number) => serverView(game, me, { status: 'finished' })],
  ])('gibt den Tisch frei: %s', (_name, view) => {
    const game = startGame(2);
    const me = toAct(game);
    const { state, last } = setup(me);
    state(serverView(game, me));
    expect(last().types()).toEqual(['hello', 'table.join']);
    state(view(game, me));
    expect(last().sent.at(-1)).toEqual({ type: 'table.unwatch', tableId: 42 });
  });

  it('table.closed, table.left und TABLE_NOT_FOUND beenden den Hinweis', () => {
    const game = startGame();
    const me = toAct(game);
    const { turns, state, last } = setup(me);
    for (const end of [
      { type: 'table.closed', tableId: 42, reason: 'abandoned' } as const,
      { type: 'table.left', tableId: 42 } as const,
      { type: 'error', code: 'TABLE_NOT_FOUND', message: 'weg', requestId: null, tableId: 42 } as const,
    ]) {
      state(serverView(game, me, { turnClock: clockFor(game) }));
      expect(turns.getSnapshot()).not.toBeNull();
      last().receive(end);
      expect(turns.getSnapshot()).toBeNull();
    }
  });

  it('stop gibt alle gehaltenen Tische frei', () => {
    const game = startGame();
    const me = toAct(game);
    const { turns, state, last } = setup(me);
    state(serverView(game, me));
    turns.stop();
    expect(last().sent.at(-1)).toEqual({ type: 'table.unwatch', tableId: 42 });
  });
});
