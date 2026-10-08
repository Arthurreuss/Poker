import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LobbyTable } from '@poker/engine/protocol';
import { LobbyClient, LobbyRequestError } from './client';
import { fakeSocketFactory } from './fakeSocket';

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
  const f = fakeSocketFactory();
  const client = new LobbyClient({ socketFactory: f.factory, url: 'ws://test/ws', subscribe });
  const changes = vi.fn();
  client.subscribe(changes);
  client.start();
  return { ...f, client, changes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('LobbyClient', () => {
  it('hello → welcome → lobby.subscribe; Liste folgt snapshot/update/remove', () => {
    const { client, latest } = setup();
    const s = latest();
    expect(s.url).toBe('ws://test/ws');
    expect(client.getSnapshot().status).toBe('connecting');
    s.open();
    expect(s.sent).toEqual([{ type: 'hello', protocolVersion: 1 }]);
    s.receive({ type: 'welcome', protocolVersion: 1, user: { id: 2, username: 'x' } });
    expect(s.sent.at(-1)).toEqual({ type: 'lobby.subscribe' });
    expect(client.getSnapshot().status).toBe('online');

    s.receive({ type: 'lobby.snapshot', tables: [table(3), table(1)] });
    expect(client.getSnapshot().tables.map((t) => t.id)).toEqual([1, 3]);
    s.receive({ type: 'lobby.update', table: table(2) });
    s.receive({ type: 'lobby.update', table: table(1, { seated: 2 }) });
    expect(client.getSnapshot().tables.map((t) => [t.id, t.seated])).toEqual([
      [1, 2],
      [2, 0],
      [3, 0],
    ]);
    s.receive({ type: 'lobby.remove', tableId: 3 });
    expect(client.getSnapshot().tables.map((t) => t.id)).toEqual([1, 2]);
  });

  it('ohne subscribe (Einladungsseite) kein lobby.subscribe', () => {
    const { latest } = setup(false);
    latest().welcome();
    expect(latest().sent.map((m) => m.type)).toEqual(['hello']);
  });

  it('createTable: Antwort über requestId, Fehler als LobbyRequestError', async () => {
    const { client, latest } = setup();
    const s = latest();
    s.welcome();
    const created = client.createTable({ name: 'Freitag' });
    const sent = s.last('table.create');
    expect(sent.settings).toEqual({ name: 'Freitag' });
    s.receive({ type: 'table.created', requestId: sent.requestId ?? null, tableId: 7, inviteCode: 'abc' });
    await expect(created).resolves.toEqual({ tableId: 7, inviteCode: 'abc' });

    const failed = client.createTable({ name: 'x' });
    const req = s.last('table.create').requestId ?? null;
    s.receive({ type: 'error', code: 'INVALID_SETTINGS', message: 'kaputt', requestId: req, tableId: null });
    await expect(failed).rejects.toMatchObject({ code: 'INVALID_SETTINGS', message: 'kaputt' });
  });

  it('joinByInvite: Tisch-ID aus table.state mit passendem Code', async () => {
    const { client, latest } = setup(false);
    const s = latest();
    s.welcome();
    const joined = client.joinByInvite('code-1');
    expect(s.last('table.join')).toMatchObject({ inviteCode: 'code-1' });
    s.receive({ type: 'table.state', table: { id: 12, inviteCode: 'code-1' } as never });
    await expect(joined).resolves.toBe(12);
  });

  it('ohne Verbindung schlagen Anfragen sofort fehl; Abbruch lässt offene Anfragen scheitern', async () => {
    const { client, latest } = setup();
    await expect(client.createTable({ name: 'x' })).rejects.toBeInstanceOf(LobbyRequestError);
    latest().welcome();
    const pending = client.joinByInvite('abc');
    latest().serverClose(1006);
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
  });

  it('verbindet nach Abbruch mit Backoff neu und abonniert erneut', () => {
    vi.useFakeTimers();
    const { client, sockets, latest } = setup();
    latest().welcome();
    latest().serverClose(1006);
    expect(client.getSnapshot().status).toBe('connecting');
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
    latest().welcome();
    expect(latest().sent.map((m) => m.type)).toEqual(['hello', 'lobby.subscribe']);
    expect(client.getSnapshot().status).toBe('online');
    client.stop();
  });

  it('4001 (anderer Tab) und 4000 (alte Version): kein automatischer Reconnect', () => {
    vi.useFakeTimers();
    const { client, sockets, latest } = setup();
    latest().welcome();
    latest().serverClose(4001);
    expect(client.getSnapshot().status).toBe('replaced');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);

    client.reconnect();
    expect(sockets).toHaveLength(2);
    latest().welcome();
    latest().serverClose(4000);
    expect(client.getSnapshot().status).toBe('outdated');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
  });

  it('pingt alle 20 s; ohne Antwort binnen 10 s wird neu verbunden', () => {
    vi.useFakeTimers();
    const { sockets, latest, client } = setup();
    const first = latest();
    first.welcome();
    vi.advanceTimersByTime(20_000);
    expect(first.sent.at(-1)).toEqual({ type: 'ping' });
    first.receive({ type: 'pong', requestId: null, serverNowMs: 1 });
    vi.advanceTimersByTime(20_000);
    vi.advanceTimersByTime(10_000);
    expect(first.closed).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it('stop schließt die Verbindung und benachrichtigt nicht mehr', () => {
    const { client, latest, changes } = setup();
    latest().welcome();
    client.stop();
    expect(latest().closed).toEqual({ code: 1000, reason: 'lobby closed' });
    const calls = changes.mock.calls.length;
    latest().receive({ type: 'lobby.update', table: table(1) });
    expect(changes.mock.calls.length).toBe(calls);
  });
});
