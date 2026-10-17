// Admin zieht neue eigene Karten (WP-035, D-032) über echte WebSockets, ohne DB (Fake-Sessions, In-Memory-Repository).
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng, type Card } from '@poker/engine';
import type { ServerMessage, TableSettingsInput, TableView } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { Database } from '../db';
import type { CardRedrawAudit } from './admin-reveal';
import { InMemoryTableRepository } from './repository';
import { TestClient, fakeAuthenticate } from './ws-test-client';

const ORIGIN = 'http://localhost:4310';
const fakeDb: Database = {
  ping: () => Promise.resolve(),
  query: () => Promise.reject(new Error('nicht verwendet')),
  close: () => Promise.resolve(),
};
const SETTINGS: TableSettingsInput = {
  name: 'Neuziehen',
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

function ownCards(table: TableView, userId: number): Card[] {
  return table.round?.hand?.players.find((p) => p.playerId === String(userId))?.holeCards ?? [];
}

const inHand = (t: TableView): boolean => t.round?.hand?.phase === 'betting';

/** Admin (User 1) und User 2 sitzen, die erste Hand läuft. */
async function setup(audit: (entry: CardRedrawAudit) => Promise<boolean>) {
  app = buildApp({
    db: fakeDb,
    publicOrigin: ORIGIN,
    game: {
      repository: new InMemoryTableRepository(),
      authenticate: fakeAuthenticate,
      handPauseMs: 0,
      rng: createSeededRng(8),
      redrawAudit: audit,
    },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `ws://127.0.0.1:${String((app.server.address() as AddressInfo).port)}/ws`;
  const connect = async (cookie: string, userId: number) => {
    const c = await TestClient.connect(url, ORIGIN, `poker_session=${cookie}`, userId);
    clients.push(c);
    return c;
  };
  const admin = await connect('admin-1', 1);
  const other = await connect('user-2', 2);
  admin.send({ type: 'table.create', settings: SETTINGS });
  const tableId = (
    await admin.next<Extract<ServerMessage, { type: 'table.created' }>>((m) => m.type === 'table.created')
  ).tableId;
  for (const [cl, seat] of [
    [admin, 0],
    [other, 4],
  ] as const) {
    cl.send({ type: 'table.join', tableId });
    cl.send({ type: 'table.sit', tableId, seat });
    await cl.nextState((t) => t.seats.some((s) => s.user.id === cl.userId));
  }
  admin.send({ type: 'table.start', tableId });
  const first = await admin.nextState(inHand);
  await other.nextState(inHand);
  return { admin, other, tableId, first: first.table };
}

/** Rundreise über `ping`: danach sind alle vorher an diese Verbindung gesendeten Nachrichten angekommen. */
async function flush(client: TestClient): Promise<void> {
  client.send({ type: 'ping', requestId: 'flush' });
  await client.next((m) => m.type === 'pong' && m.requestId === 'flush');
}

describe('admin.redrawCards über WebSockets', () => {
  it('Admin bekommt beliebig oft neue Karten aus dem Restdeck; Mitspieler merken nichts', async () => {
    const audits: CardRedrawAudit[] = [];
    const { admin, other, tableId, first } = await setup((entry) => {
      audits.push(entry);
      return Promise.resolve(true);
    });
    await flush(other);
    const otherCount = other.messages.length;
    const otherCards = ownCards(other.latestState() as TableView, 2);
    expect(otherCards).toHaveLength(2);

    let previous = ownCards(first, 1);
    const seen = new Set(previous);
    for (let i = 0; i < 10; i++) {
      admin.send({ type: 'admin.redrawCards', tableId, requestId: `redraw:${String(i)}` });
      const { table } = await admin.nextState(inHand);
      const cards = ownCards(table, 1);
      expect(cards).toHaveLength(2);
      expect(cards).not.toEqual(previous);
      for (const card of cards) expect(otherCards).not.toContain(card);
      for (const card of cards) seen.add(card);
      // Sonst bleibt alles gleich (kein Zug, keine Einsätze).
      expect(table.round?.hand?.actionSeq).toBe(first.round?.hand?.actionSeq);
      previous = cards;
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(audits).toHaveLength(10);
    expect(audits.every((a) => a.adminId === 1 && a.tableId === tableId && a.seat === 0)).toBe(true);

    await flush(other);
    // Der Mitspieler bekam nur den Pong: keine Sicht, keine Nachricht zum Neuziehen.
    expect(other.messages.slice(otherCount).map((m) => m.type)).toEqual(['pong']);
    expect(ownCards(other.latestState() as TableView, 2)).toEqual(otherCards);
  }, 15_000);

  it('Nicht-Admin bekommt FORBIDDEN; verneint die DB das Admin-Recht, bleiben die Karten', async () => {
    let allowed = true;
    const { admin, other, tableId, first } = await setup(() => Promise.resolve(allowed));

    other.send({ type: 'admin.redrawCards', tableId, requestId: 'x' });
    expect((await other.nextError()).code).toBe('FORBIDDEN');

    allowed = false;
    admin.send({ type: 'admin.redrawCards', tableId, requestId: 'y' });
    expect((await admin.nextError()).code).toBe('FORBIDDEN');
    expect(ownCards(admin.latestState() as TableView, 1)).toEqual(ownCards(first, 1));
  }, 15_000);
});
