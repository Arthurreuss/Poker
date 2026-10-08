// WP-012 über echte WebSockets (ohne DB): Reconnect mitten in der Hand, zwei Tabs desselben Users,
// Zug-Timer und Anwendungs-Heartbeat. Zeit über `ManualClock` – kein echtes Warten auf Timer.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import { CLOSE_REPLACED, type ServerMessage, type TableSettingsInput, type TableView } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { Database } from '../db';
import { ManualClock } from './clock';
import { DEFAULT_DISCONNECT_GRACE_MS } from './game-server';
import { InMemoryTableRepository } from './repository';
import { TestClient, fakeAuthenticate } from './ws-test-client';

const ORIGIN = 'http://localhost:4310';
const T0 = 5_000_000;
const fakeDb: Database = {
  ping: () => Promise.resolve(),
  query: () => Promise.reject(new Error('nicht verwendet')),
  close: () => Promise.resolve(),
};
const SETTINGS: TableSettingsInput = {
  name: 'Reconnect',
  startingStack: 1000,
  blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
};

let app: FastifyInstance | undefined;
let clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients) c.close();
  clients = [];
  await app?.close();
  app = undefined;
});

async function start(): Promise<{ url: string; clock: ManualClock }> {
  const clock = new ManualClock(T0);
  app = buildApp({
    db: fakeDb,
    publicOrigin: ORIGIN,
    game: {
      repository: new InMemoryTableRepository(),
      authenticate: fakeAuthenticate,
      handPauseMs: 3000,
      clock,
      rng: createSeededRng(11),
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${String(port)}/ws`, clock };
}

async function connect(url: string, userId: number): Promise<TestClient> {
  const c = await TestClient.connect(url, ORIGIN, `poker_session=user-${String(userId)}`, userId);
  clients.push(c);
  return c;
}

/** Zwei Spieler (User 1 Sitz 0, User 2 Sitz 1), Runde gestartet; liefert die Zustände nach dem Start. */
async function runningTable(url: string) {
  const a = await connect(url, 1);
  const b = await connect(url, 2);
  a.send({ type: 'table.create', settings: SETTINGS });
  const { table } = await a.nextState();
  const id = table.id;
  a.send({ type: 'table.sit', tableId: id, seat: 0 });
  await a.nextState((t) => t.seats.length === 1);
  b.send({ type: 'table.join', tableId: id });
  await b.nextState();
  b.send({ type: 'table.sit', tableId: id, seat: 1 });
  await b.nextState((t) => t.seats.length === 2);
  a.send({ type: 'table.start', tableId: id });
  await a.nextState((t) => t.round?.hand?.phase === 'betting');
  await b.nextState((t) => t.round?.hand?.phase === 'betting');
  return { a, b, id };
}

const seat = (t: TableView | undefined, userId: number) => t?.seats.find((s) => s.user.id === userId);

describe('Reconnect über WebSockets', () => {
  it('Abbruch mitten in der Hand → neue Verbindung → identischer Zustand inkl. eigener Hole Cards', async () => {
    const { url, clock } = await start();
    const { a, b, id } = await runningTable(url);
    // Eine Aktion spielen, damit der Zustand nicht der Anfangszustand ist.
    const hand = a.latestState()?.round?.hand;
    const actor = hand?.toActId === '1' ? a : b;
    actor.send({ type: 'table.action', tableId: id, handNumber: 1, seq: hand?.actionSeq, action: { type: 'call' } });
    await a.nextState((t) => t.round?.hand?.actionSeq === (hand?.actionSeq ?? 0) + 1);
    await b.nextState((t) => t.round?.hand?.actionSeq === (hand?.actionSeq ?? 0) + 1);
    clock.advance(1000);
    const before = b.latestState();
    expect(before?.round?.hand?.players.find((p) => p.playerId === '2')?.holeCards).toHaveLength(2);

    b.ws.terminate(); // harter Abbruch, kein Close-Handshake
    const seen = await a.nextState((t) => seat(t, 2)?.connected === false);
    expect(seen.table.round?.hand?.actionSeq).toBe(before?.round?.hand?.actionSeq);

    const b2 = await connect(url, 2);
    b2.send({ type: 'table.join', tableId: id });
    const { table: after } = await b2.nextState();
    // Alles gleich bis auf den Zeitpunkt der Sicht (Uhr ist seit dem letzten Zustand 1 s weiter).
    expect(after.serverNowMs).toBe(T0 + 1000);
    expect({ ...after, serverNowMs: 0 }).toEqual({ ...before, serverNowMs: 0 });
    await a.nextState((t) => seat(t, 2)?.connected === true);

    // Weiterspielen mit der neuen Verbindung klappt.
    const h = after.round?.hand;
    if (h?.toActId === '2') {
      b2.send({ type: 'table.action', tableId: id, handNumber: 1, seq: h.actionSeq, action: { type: 'check' } });
      await b2.nextState((t) => t.round?.hand?.actionSeq === h.actionSeq + 1);
    }
    expect(b2.errors()).toEqual([]);
  });

  it('getrennter Spieler am Zug wird nach der Gnadenfrist automatisch gefoldet', async () => {
    const { url, clock } = await start();
    const { a, b } = await runningTable(url);
    const toAct = a.latestState()?.round?.hand?.toActId;
    const [gone, stays] = toAct === '1' ? [a, b] : [b, a];
    gone.ws.terminate();
    const { table } = await stays.nextState((t) => seat(t, gone.userId)?.connected === false);
    expect(table.turnClock?.deadlineMs).toBe(T0 + DEFAULT_DISCONNECT_GRACE_MS);
    clock.advance(DEFAULT_DISCONNECT_GRACE_MS);
    const done = await stays.nextState((t) => t.round?.hand?.phase === 'complete');
    expect(done.table.round?.hand?.log.at(-1)).toMatchObject({ playerId: String(gone.userId), type: 'fold' });
  });
});

describe('Zwei Tabs desselben Spielers', () => {
  it('neuere Verbindung übernimmt, ältere wird mit 4001 getrennt', async () => {
    const { url } = await start();
    const { a, b, id } = await runningTable(url);
    const a2 = await connect(url, 1); // hello → übernimmt
    await new Promise<void>((resolve) => {
      if (a.closeCode !== null) resolve();
      else
        a.ws.once('close', () => {
          resolve();
        });
    });
    expect(a.closeCode).toBe(CLOSE_REPLACED);
    await b.nextState((t) => seat(t, 1)?.connected === false);

    a2.send({ type: 'table.join', tableId: id });
    const { table } = await a2.nextState();
    expect(table.you.seat).toBe(0);
    expect(table.round?.hand?.players.find((p) => p.playerId === '1')?.holeCards).toHaveLength(2);
    await b.nextState((t) => seat(t, 1)?.connected === true);
    expect(a2.closeCode).toBeNull();
  });

  it('ping → pong mit Server-Uhr', async () => {
    const { url, clock } = await start();
    const c = await connect(url, 4);
    clock.advance(7);
    c.send({ type: 'ping', requestId: 'hb-1' });
    const pong = await c.next<Extract<ServerMessage, { type: 'pong' }>>((m) => m.type === 'pong');
    expect(pong).toEqual({ type: 'pong', requestId: 'hb-1', serverNowMs: T0 + 7 });
  });
});
