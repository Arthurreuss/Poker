// Admin deckt Karten auf (WP-033, D-027) über echte WebSockets, ohne DB (Fake-Sessions, In-Memory-Repository):
// Eine ganze Runde lang fordert der Admin in jeder Hand die Karten aller Mitspieler an, ein Nicht-Admin versucht es
// ebenfalls. Danach werden alle empfangenen Nachrichten aller anderen Verbindungen auf fremde Karten geprüft.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng, type HandState } from '@poker/engine';
import type { ServerMessage, TableSettingsInput } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { Database } from '../db';
import type { CardRevealAudit } from './admin-reveal';
import { InMemoryTableRepository } from './repository';
import { TestClient, attachBot, fakeAuthenticate, findHoleCardLeaks, rawToText } from './ws-test-client';

const ORIGIN = 'http://localhost:4310';
const fakeDb: Database = {
  ping: () => Promise.resolve(),
  query: () => Promise.reject(new Error('nicht verwendet')),
  close: () => Promise.resolve(),
};
const FAST: TableSettingsInput = {
  name: 'Schnell',
  startingStack: 200,
  blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
};

type AdminCards = Extract<ServerMessage, { type: 'admin.cards' }>;

let app: FastifyInstance | undefined;
let clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients) c.close();
  clients = [];
  await app?.close();
  app = undefined;
});

/** Fordert in jeder laufenden Hand einmal die Karten jedes anderen Platzes an. */
function attachRevealer(client: TestClient, tableId: number): void {
  const asked = new Set<string>();
  client.ws.on('message', (data) => {
    const msg = JSON.parse(rawToText(data)) as ServerMessage;
    if (msg.type !== 'table.state' || msg.table.id !== tableId) return;
    const hand = msg.table.round?.hand;
    if (hand === null || hand === undefined || hand.phase !== 'betting') return;
    for (const p of hand.players) {
      if (p.playerId === String(client.userId) || p.status === 'folded') continue;
      const key = `${String(hand.handNumber)}/${String(p.seat)}`;
      if (asked.has(key)) continue;
      asked.add(key);
      client.send({ type: 'admin.revealCards', tableId, seat: p.seat });
    }
  });
}

describe('admin.revealCards über WebSockets', () => {
  it('Karten nur an den Admin; Mitspieler, Zuschauer und Nicht-Admins bekommen nie fremde Karten', async () => {
    const hands = new Map<number, HandState>();
    const audits: CardRevealAudit[] = [];
    app = buildApp({
      db: fakeDb,
      publicOrigin: ORIGIN,
      game: {
        repository: new InMemoryTableRepository(),
        authenticate: fakeAuthenticate,
        handPauseMs: 0,
        rng: createSeededRng(4),
        hooks: {
          onHandStarted: (e) => {
            hands.set(e.handNumber, e.hand);
          },
        },
        revealAudit: (entry) => {
          audits.push(entry);
          return Promise.resolve(true);
        },
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
    const b = await connect('user-2', 2);
    const c = await connect('user-3', 3);
    const spectator = await connect('user-9', 9);
    expect(admin.messages[0]).toMatchObject({ type: 'welcome', isAdmin: true });
    expect(b.messages[0]).toMatchObject({ type: 'welcome', isAdmin: false });

    admin.send({ type: 'table.create', settings: FAST });
    const id = (await admin.next<Extract<ServerMessage, { type: 'table.created' }>>((m) => m.type === 'table.created'))
      .tableId;
    for (const [cl, seat] of [
      [admin, 0],
      [b, 3],
      [c, 6],
    ] as const) {
      cl.send({ type: 'table.join', tableId: id });
      cl.send({ type: 'table.sit', tableId: id, seat });
      await cl.nextState((t) => t.seats.some((s) => s.user.id === cl.userId));
    }
    spectator.send({ type: 'table.join', tableId: id });
    await spectator.nextState((t) => t.id === id);

    for (const [i, cl] of [admin, b, c].entries()) attachBot(cl, id, 200 + i);
    attachRevealer(admin, id);
    attachRevealer(b, id); // Nicht-Admin versucht es ebenfalls
    admin.send({ type: 'table.start', tableId: id });

    await Promise.all([admin, b, c, spectator].map((cl) => cl.next((m) => m.type === 'table.roundFinished', 20_000)));
    await app.game.idle();

    // Admin: Karten kamen an und stimmen mit dem Serverzustand überein.
    const revealed = admin.messages.filter((m): m is AdminCards => m.type === 'admin.cards');
    expect(revealed.length).toBeGreaterThan(0);
    const userOfSeat = new Map([
      [0, '1'],
      [3, '2'],
      [6, '3'],
    ]);
    for (const r of revealed) {
      const real = hands.get(r.handNumber)?.players.find((p) => p.id === userOfSeat.get(r.seat));
      expect(r.cards).toEqual(real?.holeCards);
      expect(r.seat).not.toBe(0);
    }
    // Je Hand und Platz höchstens ein Protokolleintrag, alle vom Admin.
    const keys = audits.map((a) => `${String(a.handNumber)}/${String(a.seat)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(audits.every((a) => a.adminId === 1 && a.tableId === id)).toBe(true);
    expect(audits.length).toBeGreaterThan(0);

    // Nicht-Admin: nur FORBIDDEN, nie Karten.
    expect(b.messages.some((m) => m.type === 'admin.cards')).toBe(false);
    expect(b.errors().length).toBeGreaterThan(0);
    expect(b.errors().every((e) => e.code === 'FORBIDDEN')).toBe(true);

    // Alle anderen Verbindungen: keine admin.cards, keine fremden Karten in irgendeiner Nachricht (Text-Suche).
    for (const cl of [b, c, spectator]) {
      expect(cl.raw.some((r) => r.includes('admin.cards'))).toBe(false);
      expect(findHoleCardLeaks(cl, hands), `User ${String(cl.userId)}`).toEqual([]);
    }
    // Auch der Admin bekommt fremde Karten nie über table.state.
    expect(findHoleCardLeaks(admin, hands)).toEqual([]);
  }, 30_000);
});
