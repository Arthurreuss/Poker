// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LobbyTable } from '@poker/engine/protocol';
import { fakeConnection } from '../game/test/fakeSocket';
import { LobbyClient, LobbyRequestError } from './client';

const table = (id: number, patch: Partial<LobbyTable> = {}): LobbyTable => ({
  id,
  name: `Tisch ${String(id)}`,
  createdBy: { id: 1, username: 'arthur' },
  status: 'open',
  seated: 0,
  maxSeats: 9,
  startingStack: 1500,
  blinds: { smallBlind: 10, bigBlind: 20 },
  blindType: 'increasing',
  turnTimeSeconds: 20,
  timeBankSeconds: 60,
  ...patch,
});

function setup(subscribe = true) {
  const fake = fakeConnection();
  const client = new LobbyClient(fake.connection, { subscribe });
  const changes = vi.fn();
  client.subscribe(changes);
  client.start();
  return { ...fake, client, changes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LobbyClient', () => {
  it('nutzt die Verbindung der App: welcome → lobby.subscribe; Liste folgt snapshot/update/remove', () => {
    const { client, last, sockets } = setup();
    expect(client.getSnapshot().status).toBe('connecting');
    last().welcome();
    expect(sockets).toHaveLength(1);
    expect(last().types()).toEqual(['hello', 'lobby.subscribe']);
    expect(client.getSnapshot().status).toBe('online');

    last().receive({ type: 'lobby.snapshot', tables: [table(3), table(1)] });
    expect(client.getSnapshot().tables.map((t) => t.id)).toEqual([1, 3]);
    last().receive({ type: 'lobby.update', table: table(2) });
    last().receive({ type: 'lobby.update', table: table(1, { seated: 2 }) });
    expect(client.getSnapshot().tables.map((t) => [t.id, t.seated])).toEqual([
      [1, 2],
      [2, 0],
      [3, 0],
    ]);
    last().receive({ type: 'lobby.remove', tableId: 3 });
    expect(client.getSnapshot().tables.map((t) => t.id)).toEqual([1, 2]);
  });

  it('ohne subscribe (Einladungsseite) kein lobby.subscribe', () => {
    const { last } = setup(false);
    last().welcome();
    expect(last().types()).toEqual(['hello']);
  });

  it('createTable: Antwort über requestId, Fehler als LobbyRequestError', async () => {
    const { client, last } = setup();
    last().welcome();
    const created = client.createTable({ name: 'Freitag' });
    const sent = last().last('table.create');
    expect(sent.settings).toEqual({ name: 'Freitag' });
    last().receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 7, inviteCode: 'abc' });
    await expect(created).resolves.toEqual({ tableId: 7, inviteCode: 'abc' });

    const failed = client.createTable({ name: 'x' });
    const req = last().last('table.create').requestId ?? null;
    last().receive({ type: 'error', code: 'INVALID_SETTINGS', message: 'kaputt', requestId: req, tableId: null });
    await expect(failed).rejects.toMatchObject({ code: 'INVALID_SETTINGS', message: 'kaputt' });
  });

  it('joinByInvite: Tisch-ID aus table.state mit passendem Code', async () => {
    const { client, last } = setup(false);
    last().welcome();
    const joined = client.joinByInvite('code-1');
    expect(last().last('table.join')).toMatchObject({ inviteCode: 'code-1' });
    last().receive({ type: 'table.state', table: { id: 12, inviteCode: 'code-1' } as never });
    await expect(joined).resolves.toBe(12);
  });

  it('ohne Verbindung schlagen Anfragen sofort fehl; Abbruch lässt offene Anfragen scheitern', async () => {
    const { client, last } = setup();
    await expect(client.createTable({ name: 'x' })).rejects.toBeInstanceOf(LobbyRequestError);
    last().welcome();
    const pending = client.joinByInvite('abc');
    last().serverClose(1006);
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    client.stop();
  });

  it('abonniert nach dem Wiederverbinden erneut', () => {
    vi.useFakeTimers();
    const { client, sockets, last } = setup();
    last().welcome();
    last().serverClose(1006);
    expect(client.getSnapshot().status).toBe('connecting');
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    last().welcome();
    expect(last().types()).toEqual(['hello', 'lobby.subscribe']);
    expect(client.getSnapshot().status).toBe('online');
    client.stop();
  });

  it('4001 (anderer Tab) → replaced, „Hier weiterspielen“ verbindet neu; 4000 → outdated', () => {
    const { client, sockets, last } = setup();
    last().welcome();
    last().serverClose(4001);
    expect(client.getSnapshot().status).toBe('replaced');
    client.reconnect();
    expect(sockets).toHaveLength(2);
    last().welcome();
    expect(client.getSnapshot().status).toBe('online');
    last().serverClose(4000);
    expect(client.getSnapshot().status).toBe('outdated');
  });

  it('stop meldet die Lobby ab und gibt selbst angelegte Tische frei, die Verbindung bleibt offen', async () => {
    const { client, last, changes, connection } = setup();
    last().welcome();
    const created = client.createTable({ name: 'Privat' });
    const sent = last().last('table.create');
    last().receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 4, inviteCode: 'p' });
    await created;
    client.stop();
    expect(last().sent.slice(-2)).toEqual([{ type: 'lobby.unsubscribe' }, { type: 'table.unwatch', tableId: 4 }]);
    expect(last().closed).toBeNull();
    expect(connection.status.kind).toBe('open');
    const calls = changes.mock.calls.length;
    last().receive({ type: 'lobby.update', table: table(1) });
    expect(changes.mock.calls.length).toBe(calls);
  });
});
