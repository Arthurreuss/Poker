// @vitest-environment jsdom
import { CLOSE_REPLACED, CLOSE_UNSUPPORTED_VERSION } from '@poker/engine/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF, type BrowserEvents } from './connection';
import { fakeConnection, WELCOME } from './test/fakeSocket';

function setup(options: { checkSession?: () => Promise<boolean>; events?: BrowserEvents | null } = {}) {
  return fakeConnection(options);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GameConnection – Handshake', () => {
  it('sendet hello, ist erst nach welcome offen und fordert beobachtete Tische an', () => {
    const { connection, last } = setup();
    connection.watchTable(7);
    connection.start();
    expect(connection.status.kind).toBe('connecting');
    last().open();
    expect(last().sent).toEqual([{ type: 'hello', protocolVersion: 1 }]);
    expect(connection.send({ type: 'lobby.subscribe' })).toBe(false);
    last().receive(WELCOME);
    expect(connection.status.kind).toBe('open');
    expect(connection.user).toEqual({ id: 1, username: 'anna' });
    expect(last().sent.at(-1)).toEqual({ type: 'table.join', tableId: 7 });
    expect(connection.send({ type: 'lobby.subscribe' })).toBe(true);
  });

  it('meldet Nachrichten an alle Abonnenten', () => {
    const { connection, last, connect } = setup();
    const seen: string[] = [];
    connection.onMessage((m) => seen.push(m.type));
    connection.start();
    connect();
    last().receive({ type: 'table.left', tableId: 1 });
    expect(seen).toEqual(['welcome', 'table.left']);
  });
});

describe('GameConnection – Wiederverbinden', () => {
  it('Backoff 0,5 s, 1 s, 2 s … höchstens 10 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n))).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
    expect(DEFAULT_BACKOFF.maxMs).toBe(10_000);
  });

  it('verbindet nach Abbruch mit wachsendem Abstand neu und fordert den Tisch erneut an', () => {
    const { connection, sockets, last, connect } = setup();
    connection.watchTable(3);
    connection.start();
    connect();
    last().serverClose(1006);
    expect(connection.status).toMatchObject({ kind: 'waiting', attempt: 1 });
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    // zweiter Versuch scheitert sofort → 1 s
    last().serverClose(1006);
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    last().serverClose(1006);
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(4);

    // Erfolg: Tisch wird neu angefordert, Backoff beginnt von vorn
    connect();
    expect(last().types()).toEqual(['hello', 'table.join']);
    last().serverClose(1006);
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(5);
  });

  it('„Jetzt verbinden“ wartet den Backoff nicht ab', () => {
    const { connection, sockets, last, connect } = setup();
    connection.start();
    connect();
    last().serverClose();
    connection.reconnectNow();
    expect(sockets).toHaveLength(2);
    expect(connection.status.kind).toBe('connecting');
  });

  it('stop beendet alles ohne weitere Versuche', () => {
    const { connection, sockets, last, connect } = setup();
    connection.start();
    connect();
    connection.stop();
    expect(last().closed?.code).toBe(1000);
    expect(connection.status.kind).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('4001: anderer Tab hat übernommen – kein automatisches Wiederverbinden, nur bewusst', () => {
    const { connection, sockets, last, connect } = setup();
    connection.watchTable(5);
    connection.start();
    connect();
    last().serverClose(CLOSE_REPLACED);
    expect(connection.status.kind).toBe('replaced');
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    connection.reconnectNow();
    expect(sockets).toHaveLength(2);
    connect();
    expect(last().types()).toEqual(['hello', 'table.join']);
  });

  it('4000: falsche Protokollversion – endgültig', () => {
    const { connection, sockets, last } = setup();
    connection.start();
    last().open();
    last().serverClose(CLOSE_UNSUPPORTED_VERSION);
    expect(connection.status).toMatchObject({ kind: 'failed', reason: 'version' });
    connection.reconnectNow();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('prüft nach 3 Fehlversuchen die Session und gibt bei 401 auf', async () => {
    const checkSession = vi.fn(() => Promise.resolve(false));
    const { connection, last } = setup({ checkSession });
    connection.start();
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(checkSession).not.toHaveBeenCalled();
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(0);
    expect(checkSession).toHaveBeenCalledTimes(1);
    expect(connection.status).toMatchObject({ kind: 'failed', reason: 'unauthorized' });
  });
});

describe('GameConnection – Abbruch-Erkennung', () => {
  it('sendet nach 20 s Stille ping und verbindet ohne Antwort nach 10 s neu', () => {
    const { connection, sockets, last, connect } = setup();
    connection.start();
    connect();
    vi.advanceTimersByTime(19_999);
    expect(last().types()).toEqual(['hello']);
    vi.advanceTimersByTime(1);
    expect(last().types()).toEqual(['hello', 'ping']);
    vi.advanceTimersByTime(9_999);
    expect(connection.status.kind).toBe('open');
    vi.advanceTimersByTime(1);
    expect(sockets[0]?.closed).not.toBeNull();
    expect(connection.status.kind).toBe('waiting');
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it('jede Nachricht (z. B. pong) gilt als Lebenszeichen', () => {
    const { connection, last, connect } = setup();
    connection.start();
    connect();
    vi.advanceTimersByTime(20_000);
    last().receive({ type: 'pong', requestId: null, serverNowMs: 1 });
    vi.advanceTimersByTime(15_000);
    expect(connection.status.kind).toBe('open');
    vi.advanceTimersByTime(5_000);
    expect(
      last()
        .types()
        .filter((t) => t === 'ping'),
    ).toHaveLength(2);
  });

  it('offline trennt sofort, online und Rückkehr in den Vordergrund verbinden sofort neu', () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const { connection, sockets, connect } = setup({ events: { window: win, document: doc } });
    connection.start();
    connect();
    win.dispatchEvent(new Event('offline'));
    expect(connection.status.kind).toBe('waiting');
    win.dispatchEvent(new Event('online'));
    expect(sockets).toHaveLength(2);
    sockets[1]?.serverClose(1006);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sockets).toHaveLength(3);
    connection.stop();
  });

  it('Rückkehr in den Vordergrund bei offener Verbindung: sofort ping', () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const { connection, last, connect } = setup({ events: { window: null, document: doc } });
    connection.start();
    connect();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(last().types()).toEqual(['hello', 'ping']);
  });
});
