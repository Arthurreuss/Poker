// @vitest-environment jsdom
import type { RoundStanding } from '@poker/engine';
import type { ClientMessage, TableView as ServerTableView } from '@poker/engine/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableGameStore } from './tableGame';
import { fakeConnection } from './test/fakeSocket';
import { act, serverView, startGame, toAct, USERS, type Game } from './test/fixtures';

const TABLE = 42;

function setup(viewer: number) {
  const user = USERS.find((u) => u.id === viewer) ?? USERS[0];
  const fake = fakeConnection({ welcome: { type: 'welcome', protocolVersion: 1, user: { ...user } } });
  let now = 5_000;
  const store = new TableGameStore(fake.connection, TABLE, () => now);
  store.start();
  fake.connect();
  const state = (table: ServerTableView) => {
    fake.last().receive({ type: 'table.state', table });
  };
  const actions = () =>
    fake.last().sent.filter((m): m is Extract<ClientMessage, { type: 'table.action' }> => m.type === 'table.action');
  return {
    ...fake,
    store,
    state,
    actions,
    setNow: (ms: number) => {
      now = ms;
    },
  };
}

/** Nächster Spieler nach dem, der am Zug ist (vor dem Flop sind alle aktiv). */
const nextAfter = (id: number) => (id % 3) + 1;

function handOf(table: ServerTableView | null) {
  const hand = table?.round?.hand;
  if (hand === null || hand === undefined) throw new Error('keine Hand');
  return hand;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TableGameStore – Zustand', () => {
  it('tritt dem Tisch bei und übernimmt table.state mit Empfangszeit', () => {
    const { store, state, last, setNow } = setup(1);
    expect(last().types()).toEqual(['hello', 'table.join']);
    expect(store.getSnapshot()).toMatchObject({ connection: { kind: 'open' }, table: null });
    setNow(7_000);
    const view = serverView(startGame(), 1);
    state(view);
    expect(store.getSnapshot()).toMatchObject({ table: view, receivedAtMs: 7_000, notFound: false });
  });

  it('ignoriert Nachrichten anderer Tische', () => {
    const { store, last } = setup(1);
    last().receive({ type: 'table.state', table: { ...serverView(null, 1), id: 7 } });
    expect(store.getSnapshot().table).toBeNull();
  });

  it('TABLE_NOT_FOUND: Tisch unbekannt, alter Stand verschwindet', () => {
    const { store, last, state } = setup(1);
    state(serverView(startGame(), 1));
    last().receive({ type: 'error', requestId: null, tableId: TABLE, code: 'TABLE_NOT_FOUND', message: 'weg' });
    expect(store.getSnapshot()).toMatchObject({ notFound: true, table: null });
  });

  it('table.closed: Tisch weg, Hinweis, kein erneuter Beitritt nach Reconnect', () => {
    const { store, state, last, connection, connect } = setup(1);
    state(serverView(startGame(), 1));
    last().receive({ type: 'table.closed', tableId: TABLE, reason: 'abandoned' });
    expect(store.getSnapshot()).toMatchObject({ closed: 'abandoned', table: null });
    last().serverClose(1006);
    connection.reconnectNow();
    connect();
    expect(last().types()).toEqual(['hello']);
  });

  it('stop gibt den Tisch frei, ohne die Verbindung zu beenden', () => {
    const { store, connection, last } = setup(1);
    store.stop();
    expect(connection.status.kind).toBe('open');
    last().receive({ type: 'table.state', table: serverView(null, 1) });
    expect(store.getSnapshot().table).toBeNull();
  });
});

describe('TableGameStore – Aktionen', () => {
  it('sendet handNumber und seq der letzten Sicht; Doppelklick wird verworfen', () => {
    const game = startGame();
    const me = toAct(game);
    const { store, state, actions } = setup(me);
    state(serverView(game, me));
    const hand = handOf(store.getSnapshot().table);
    expect(store.act({ type: 'call' })).toBe(true);
    expect(store.act({ type: 'call' })).toBe(false);
    expect(actions()).toEqual([
      {
        type: 'table.action',
        tableId: TABLE,
        handNumber: hand.handNumber,
        seq: hand.actionSeq,
        action: { type: 'call' },
      },
    ]);
    expect(store.getSnapshot().pendingAction).toBe(true);

    act(game, { type: 'call' });
    state(serverView(game, me));
    expect(store.getSnapshot().pendingAction).toBe(false);
  });

  it('Fehler vom Server: Meldung anzeigen, wieder bedienbar', () => {
    const game = startGame();
    const me = toAct(game);
    const { store, state, last } = setup(me);
    state(serverView(game, me));
    store.act({ type: 'check' });
    last().receive({
      type: 'error',
      requestId: null,
      tableId: TABLE,
      code: 'INVALID_ACTION',
      message: 'Check geht nicht.',
    });
    expect(store.getSnapshot()).toMatchObject({
      pendingAction: false,
      error: { code: 'INVALID_ACTION', message: 'Check geht nicht.' },
    });
    store.dismissError();
    expect(store.getSnapshot().error).toBeNull();
  });

  it('ohne Verbindung: nichts senden, Hinweis zeigen; Abbruch gibt die Aktion frei', () => {
    const game = startGame();
    const me = toAct(game);
    const { store, state, last } = setup(me);
    state(serverView(game, me));
    store.act({ type: 'fold' });
    last().serverClose(1006);
    expect(store.getSnapshot()).toMatchObject({ pendingAction: false, connection: { kind: 'waiting' } });
    expect(store.act({ type: 'fold' })).toBe(false);
    expect(store.getSnapshot().error?.code).toBe('NOT_CONNECTED');
  });

  it('sit/stand/start/rematch/leave senden die passenden Nachrichten', () => {
    const { store, last } = setup(1);
    store.sit(4);
    store.stand();
    store.startRound();
    store.rematch();
    store.leave();
    expect(last().sent.slice(2)).toEqual([
      { type: 'table.sit', tableId: TABLE, seat: 4 },
      { type: 'table.stand', tableId: TABLE },
      { type: 'table.start', tableId: TABLE },
      { type: 'table.rematch', tableId: TABLE },
      { type: 'table.leave', tableId: TABLE },
    ]);
  });
});

describe('TableGameStore – Vorab-Aktionen', () => {
  function waitingHero(): { game: Game; me: number } {
    const game = startGame();
    return { game, me: nextAfter(toAct(game)) };
  }

  it('Call any wird ausgelöst, sobald man am Zug ist – genau einmal', () => {
    const { game, me } = waitingHero();
    const { store, state, actions } = setup(me);
    state(serverView(game, me));
    store.selectPreAction({ kind: 'callAny', amount: 0 });
    const before = handOf(store.getSnapshot().table);
    expect(store.getSnapshot().preAction).toEqual({
      kind: 'callAny',
      amount: 0,
      handNumber: before.handNumber,
      street: 'preflop',
    });

    act(game, { type: 'raise', amount: 100 });
    state(serverView(game, me));
    const hand = handOf(store.getSnapshot().table);
    expect(actions()).toEqual([
      {
        type: 'table.action',
        tableId: TABLE,
        handNumber: hand.handNumber,
        seq: hand.actionSeq,
        action: { type: 'call' },
      },
    ]);
    expect(store.getSnapshot().preAction).toBeNull();
    state(serverView(game, me));
    expect(actions()).toHaveLength(1);
  });

  it('Call verfällt, wenn sich der Betrag ändert', () => {
    const { game, me } = waitingHero();
    const { store, state, actions } = setup(me);
    const view = serverView(game, me);
    state(view);
    const hand = handOf(view);
    const mine = hand.players.find((p) => p.playerId === String(me));
    store.selectPreAction({ kind: 'call', amount: hand.currentBet - (mine?.streetBet ?? 0) });
    act(game, { type: 'raise', amount: 100 });
    state(serverView(game, me));
    expect(store.getSnapshot().preAction).toBeNull();
    expect(actions()).toEqual([]);
  });

  it('am Zug oder als Zuschauer keine Vorab-Aktion', () => {
    const game = startGame();
    const me = toAct(game);
    const { store, state } = setup(me);
    state(serverView(game, me));
    store.selectPreAction({ kind: 'checkFold', amount: 0 });
    expect(store.getSnapshot().preAction).toBeNull();
  });
});

describe('TableGameStore – Rundenende', () => {
  const standings: RoundStanding[] = [
    { playerId: '2', seat: 1, placement: 1, sharedPlacement: false, points: 10 },
    { playerId: '1', seat: 0, placement: 2, sharedPlacement: true, points: 4 },
    { playerId: '3', seat: 2, placement: 2, sharedPlacement: true, points: 4 },
  ];
  function finished(): ServerTableView {
    const view = serverView(startGame(), 1);
    if (view.round === null) throw new Error();
    return { ...view, status: 'finished', round: { ...view.round, phase: 'finished', standings } };
  }

  it('table.roundFinished öffnet das Ergebnis, Schließen und erneut zeigen', () => {
    const { store, state, last } = setup(1);
    state(finished());
    store.dismissStandings();
    last().receive({
      type: 'table.roundFinished',
      tableId: TABLE,
      standings: standings.map((s) => ({ ...s, user: { id: Number(s.playerId), username: 'x' } })),
    });
    expect(store.getSnapshot().standings).toHaveLength(3);
    store.dismissStandings();
    expect(store.getSnapshot().standings).toBeNull();
    store.showStandings();
    expect(store.getSnapshot().standings?.map((s) => s.user.username)).toEqual(['ben', 'anna', 'cleo']);
  });

  it('Nochmal: neuer Stand mit laufender Runde schließt das Ergebnis', () => {
    const { store, state } = setup(1);
    state(finished());
    expect(store.getSnapshot().standings).not.toBeNull();
    state(serverView(startGame(), 1));
    expect(store.getSnapshot().standings).toBeNull();
  });

  it('nach Reconnect (roundFinished verpasst) aus dem Zustand – aber nur beim Wechsel auf beendet', () => {
    const { store, state } = setup(1);
    state(serverView(startGame(), 1));
    state(finished());
    expect(store.getSnapshot().standings?.[0]).toMatchObject({ playerId: '2', user: { username: 'ben' } });
    store.dismissStandings();
    state(finished());
    expect(store.getSnapshot().standings).toBeNull();
  });
});
