// Transport-Tests für `/ws` (WP-011): Upgrade mit Origin- und Session-Prüfung, Handshake, Heartbeat.
// Ohne Datenbank: Sessions über eine Fake-`authenticate`, Tische im In-Memory-Repository.
import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '@poker/engine/protocol';
import { buildApp } from './app';
import type { Database } from './db';
import { CLOSE_UNSUPPORTED_VERSION } from './game/game-server';
import { InMemoryTableRepository } from './game/repository';
import { TestClient, fakeAuthenticate } from './game/ws-test-client';

const ORIGIN = 'https://poker.example.test';
const fakeDb: Database = {
  ping: () => Promise.resolve(),
  query: () => Promise.reject(new Error('nicht verwendet')),
  close: () => Promise.resolve(),
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(heartbeatIntervalMs?: number): Promise<string> {
  app = buildApp({
    db: fakeDb,
    publicOrigin: ORIGIN,
    ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
    game: { repository: new InMemoryTableRepository(), authenticate: fakeAuthenticate, handPauseMs: 0 },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${String(port)}`;
}

/** Liefert den HTTP-Status, mit dem der Server das Upgrade ablehnt. */
function rejectedStatus(url: string, origin?: string, cookie?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      ...(origin === undefined ? {} : { origin }),
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    });
    ws.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('open', () => {
      reject(new Error('Verbindung wurde unerwartet akzeptiert'));
      ws.terminate();
    });
    ws.once('error', () => undefined);
  });
}

const connect = (url: string, userId = 1, opts?: { hello?: boolean }) =>
  TestClient.connect(`${url}/ws`, ORIGIN, `poker_session=user-${String(userId)}`, userId, opts);

describe('WebSocket /ws: Upgrade', () => {
  it('akzeptiert gültige Session und Origin; hello → welcome mit Protokollversion und User', async () => {
    const url = await start();
    const c = await connect(url, 7, { hello: false });
    c.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
    expect(await c.next((m) => m.type === 'welcome')).toEqual({
      type: 'welcome',
      protocolVersion: PROTOCOL_VERSION,
      user: { id: 7, username: 'user7' },
    });
    c.close();
  });

  it('lehnt ein Upgrade ohne Session mit 401 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/ws`, ORIGIN)).toBe(401);
    expect(await rejectedStatus(`${url}/ws`, ORIGIN, 'poker_session=unbekannt')).toBe(401);
  });

  it('lehnt eine fremde Origin mit 403 ab (auch mit gültiger Session)', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/ws`, 'https://evil.example', 'poker_session=user-1')).toBe(403);
  });

  it('erlaubt mehrere Origins (zweite Domain, D-023)', async () => {
    const second = 'https://poker.zweite.example';
    app = buildApp({
      db: fakeDb,
      publicOrigin: [ORIGIN, second],
      game: { repository: new InMemoryTableRepository(), authenticate: fakeAuthenticate, handPauseMs: 0 },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const url = `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`;
    // 401 = Origin akzeptiert, erst die (fehlende) Session scheitert.
    expect(await rejectedStatus(`${url}/ws`, second)).toBe(401);
    expect(await rejectedStatus(`${url}/ws`, ORIGIN)).toBe(401);
    expect(await rejectedStatus(`${url}/ws`, 'https://evil.example', 'poker_session=user-1')).toBe(403);
  });

  it('lehnt ein Upgrade ohne Origin mit 403 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/ws`, undefined, 'poker_session=user-1')).toBe(403);
  });

  it('lehnt Upgrades auf anderen Pfaden mit 404 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/anders`, ORIGIN, 'poker_session=user-1')).toBe(404);
  });

  it('antwortet mit 500, wenn die Session-Prüfung fehlschlägt (z. B. DB weg)', async () => {
    app = buildApp({
      db: fakeDb,
      publicOrigin: ORIGIN,
      game: { repository: new InMemoryTableRepository(), authenticate: () => Promise.reject(new Error('DB weg')) },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    expect(await rejectedStatus(`ws://127.0.0.1:${String(port)}/ws`, ORIGIN, 'poker_session=user-1')).toBe(500);
  });

  it('nutzt standardmäßig die Session aus der DB (getUserFromCookieHeader)', async () => {
    app = buildApp({ db: fakeDb, publicOrigin: ORIGIN });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    // Gut geformtes Token → DB-Abfrage → fakeDb wirft → 500; ohne Cookie gar keine Abfrage → 401.
    const token = 'a'.repeat(43);
    expect(await rejectedStatus(`ws://127.0.0.1:${String(port)}/ws`, ORIGIN, `poker_session=${token}`)).toBe(500);
    expect(await rejectedStatus(`ws://127.0.0.1:${String(port)}/ws`, ORIGIN)).toBe(401);
  });
});

describe('WebSocket /ws: Handshake und Nachrichten', () => {
  it('verlangt hello vor allen anderen Nachrichten', async () => {
    const url = await start();
    const c = await connect(url, 1, { hello: false });
    c.send({ type: 'lobby.subscribe', requestId: 'r1' });
    expect(await c.nextError()).toMatchObject({ code: 'HELLO_REQUIRED', requestId: 'r1' });
    c.close();
  });

  it('lehnt eine andere Protokollversion ab und trennt die Verbindung', async () => {
    const url = await start();
    const c = await connect(url, 1, { hello: false });
    c.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION + 1 });
    expect(await c.nextError()).toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    await new Promise((resolve) => c.ws.once('close', resolve));
    expect(c.closeCode).toBe(CLOSE_UNSUPPORTED_VERSION);
  });

  it('beantwortet ungültige Nachrichten mit BAD_MESSAGE und bleibt verbunden', async () => {
    const url = await start();
    const c = await connect(url);
    c.sendRaw('kein json');
    expect(await c.nextError()).toMatchObject({ code: 'BAD_MESSAGE', requestId: null });
    c.send({ type: 'table.sit', tableId: 1, seat: 99, requestId: 'x' });
    expect(await c.nextError()).toMatchObject({ code: 'BAD_MESSAGE', requestId: 'x' });
    c.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await c.nextError()).toMatchObject({ code: 'BAD_MESSAGE' });
    c.send({ type: 'lobby.subscribe' });
    expect(await c.next((m) => m.type === 'lobby.snapshot')).toEqual({ type: 'lobby.snapshot', tables: [] });
    c.close();
  });

  it(`trennt bei Nachrichten über ${String(MAX_MESSAGE_BYTES)} Bytes (1009)`, async () => {
    const url = await start();
    const c = await connect(url);
    c.sendRaw('x'.repeat(MAX_MESSAGE_BYTES + 1));
    const code = await new Promise<number>((resolve) => c.ws.once('close', resolve));
    expect(code).toBe(1009);
  });
});

describe('WebSocket /ws: Heartbeat und Herunterfahren', () => {
  it('sendet Heartbeat-Pings und trennt Clients ohne Pong', async () => {
    const url = await start(30);
    const ws = new WebSocket(`${url}/ws`, {
      origin: ORIGIN,
      headers: { cookie: 'poker_session=user-1' },
      autoPong: false,
    });
    const ping = new Promise<void>((resolve) => {
      ws.once('ping', () => {
        resolve();
      });
    });
    const closed = new Promise<number>((resolve) => {
      ws.once('close', (code) => {
        resolve(code);
      });
    });
    await ping;
    // Kein Pong → spätestens beim nächsten Heartbeat getrennt (terminate → 1006).
    expect(await closed).toBe(1006);
  });

  it('hält Clients mit Pong verbunden', async () => {
    const url = await start(30);
    const c = await connect(url);
    let pings = 0;
    c.ws.on('ping', () => (pings += 1));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.close();
  });

  it('beendet offene Verbindungen beim Schließen der App', async () => {
    const url = await start();
    const c = await connect(url);
    const closed = new Promise<void>((resolve) => {
      c.ws.once('close', () => {
        resolve();
      });
    });
    await app?.close();
    app = undefined;
    await closed;
    expect(c.ws.readyState).toBe(WebSocket.CLOSED);
  });
});

describe('trustProxy', () => {
  it.each([
    [true, '203.0.113.7'],
    [false, '127.0.0.1'],
  ])('trustProxy=%s → request.ip %s', async (trustProxy, expected) => {
    app = buildApp({ db: fakeDb, publicOrigin: ORIGIN, trustProxy });
    app.get('/ip', (request) => request.ip);
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.body).toBe(expected);
  });
});
