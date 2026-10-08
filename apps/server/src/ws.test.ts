import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { buildApp } from './app';
import type { Database } from './db';

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
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return `ws://127.0.0.1:${String(port)}`;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => {
      resolve(Array.isArray(data) ? Buffer.concat(data).toString() : new TextDecoder().decode(data));
    });
    ws.once('error', reject);
  });
}

/** Liefert den HTTP-Status, mit dem der Server das Upgrade ablehnt. */
function rejectedStatus(url: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin === undefined ? {} : { origin });
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

describe('WebSocket /ws (Platzhalter)', () => {
  it('akzeptiert die erlaubte Origin, sendet hello und echot Nachrichten', async () => {
    const url = await start();
    const ws = new WebSocket(`${url}/ws`, { origin: ORIGIN });
    expect(JSON.parse(await nextMessage(ws))).toEqual({ type: 'hello', placeholder: true });

    ws.send('ping-test');
    expect(await nextMessage(ws)).toBe('ping-test');
    ws.close();
  });

  it('lehnt eine fremde Origin mit 403 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/ws`, 'https://evil.example')).toBe(403);
  });

  it('lehnt ein Upgrade ohne Origin mit 403 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/ws`)).toBe(403);
  });

  it('lehnt Upgrades auf anderen Pfaden mit 404 ab', async () => {
    const url = await start();
    expect(await rejectedStatus(`${url}/anders`, ORIGIN)).toBe(404);
  });

  it('sendet Heartbeat-Pings und trennt Clients ohne Pong', async () => {
    const url = await start(30);
    const ws = new WebSocket(`${url}/ws`, { origin: ORIGIN, autoPong: false });
    await nextMessage(ws);

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
    const ws = new WebSocket(`${url}/ws`, { origin: ORIGIN });
    await nextMessage(ws);

    let pings = 0;
    ws.on('ping', () => (pings += 1));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(pings).toBeGreaterThanOrEqual(2);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('beendet offene Verbindungen beim Schließen der App', async () => {
    const url = await start();
    const ws = new WebSocket(`${url}/ws`, { origin: ORIGIN });
    await nextMessage(ws);
    const closed = new Promise<void>((resolve) => {
      ws.once('close', () => {
        resolve();
      });
    });

    await app?.close();
    app = undefined;
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
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
