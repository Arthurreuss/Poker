// Integrationstests Spielablauf über echte WebSocket-Verbindungen (WP-011), ohne DB:
// Sessions per Fake-authenticate, Tische im In-Memory-Repository, Pause nach jeder Hand 0.
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng, type HandState } from '@poker/engine';
import type { ServerMessage, TableSettingsInput, TableView } from '@poker/engine/protocol';
import { buildApp } from '../app';
import type { Database } from '../db';
import type { GameHooks } from './hooks';
import { InMemoryTableRepository } from './repository';
import { TestClient, attachBot, fakeAuthenticate, findHoleCardLeaks } from './ws-test-client';

const ORIGIN = 'http://localhost:4310';
const fakeDb: Database = {
  ping: () => Promise.resolve(),
  query: () => Promise.reject(new Error('nicht verwendet')),
  close: () => Promise.resolve(),
};

/** Klein und schnell: feste Blinds, kleiner Startstack. */
const FAST: TableSettingsInput = {
  name: 'Schnell',
  startingStack: 200,
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

interface Started {
  url: string;
  repository: InMemoryTableRepository;
}

async function start(hooks: GameHooks = {}, seed = 1): Promise<Started> {
  const repository = new InMemoryTableRepository();
  app = buildApp({
    db: fakeDb,
    publicOrigin: ORIGIN,
    game: { repository, authenticate: fakeAuthenticate, handPauseMs: 0, hooks, rng: createSeededRng(seed) },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${String(port)}/ws`, repository };
}

async function connect(url: string, userId: number): Promise<TestClient> {
  const c = await TestClient.connect(url, ORIGIN, `poker_session=user-${String(userId)}`, userId);
  clients.push(c);
  return c;
}

async function createTable(c: TestClient, settings: TableSettingsInput = FAST): Promise<{ id: number; code: string }> {
  c.send({ type: 'table.create', settings, requestId: 'create' });
  const created = await c.next<Extract<ServerMessage, { type: 'table.created' }>>((m) => m.type === 'table.created');
  expect(created.requestId).toBe('create');
  return { id: created.tableId, code: created.inviteCode };
}

async function joinAndSit(c: TestClient, tableId: number, seat: number): Promise<void> {
  c.send({ type: 'table.join', tableId });
  await c.nextState((t) => t.id === tableId);
  c.send({ type: 'table.sit', tableId, seat });
  await c.nextState((t) => t.seats.some((s) => s.user.id === c.userId && s.seat === seat));
}

/** Tisch mit 3 Spielern (User 1 = Ersteller auf Sitz 0). */
async function threePlayers(url: string, settings: TableSettingsInput = FAST) {
  const [a, b, c] = [await connect(url, 1), await connect(url, 2), await connect(url, 3)];
  const { id, code } = await createTable(a, settings);
  await a.nextState((t) => t.id === id);
  a.send({ type: 'table.sit', tableId: id, seat: 0 });
  await a.nextState((t) => t.seats.length === 1);
  await joinAndSit(b, id, 3);
  await joinAndSit(c, id, 6);
  return { a, b, c, id, code };
}

const handOf = (t: TableView | undefined) => t?.round?.hand ?? null;

describe('Runde über WebSockets', () => {
  it('3 Clients spielen eine komplette Runde bis zum Sieger; niemand sieht fremde Hole Cards', async () => {
    const hands = new Map<number, HandState>();
    const completed: number[] = [];
    let roundComplete = 0;
    const { url, repository } = await start({
      onHandStarted: (e) => {
        hands.set(e.handNumber, e.hand);
      },
      onHandComplete: (e) => {
        completed.push(e.handNumber);
      },
      onRoundComplete: () => {
        roundComplete += 1;
      },
    });
    const spectator = await connect(url, 9);
    const { a, b, c, id } = await threePlayers(url);
    spectator.send({ type: 'table.join', tableId: id });
    await spectator.nextState((t) => t.id === id);

    for (const [i, client] of [a, b, c].entries()) attachBot(client, id, 100 + i);
    a.send({ type: 'table.start', tableId: id });

    const finished = await Promise.all(
      [a, b, c, spectator].map((cl) =>
        cl.next<Extract<ServerMessage, { type: 'table.roundFinished' }>>(
          (m) => m.type === 'table.roundFinished',
          20_000,
        ),
      ),
    );
    const standings = finished[0]?.standings ?? [];
    expect(finished.every((f) => JSON.stringify(f.standings) === JSON.stringify(standings))).toBe(true);
    expect(standings).toHaveLength(3);
    expect(standings.filter((s) => s.placement === 1)).toHaveLength(1);
    expect(standings.map((s) => s.user.username).sort()).toEqual(['user1', 'user2', 'user3']);
    const winner = standings[0];
    expect(winner?.points).toBe(3); // n − 1 + Bonus

    // Endzustand: Tisch beendet, Sieger hat alle Chips.
    const final = a.latestState();
    expect(final?.status).toBe('finished');
    expect(final?.round?.phase).toBe('finished');
    expect(final?.round?.players.find((p) => p.placement === 1)?.stack).toBe(600);

    // Persistenz (minimal) und Hooks.
    await app?.game.idle();
    const round = [...repository.rounds.values()][0];
    expect(round?.status).toBe('finished');
    expect(round?.players.map((p) => p.placement).sort()).toEqual(standings.map((s) => s.placement).sort());
    expect(repository.tables.get(id)?.status).toBe('closed');
    expect(roundComplete).toBe(1);
    expect(completed.length).toBe(hands.size);
    expect(hands.size).toBeGreaterThan(0);

    // D-003: alle empfangenen Nachrichten prüfen.
    for (const client of [a, b, c, spectator]) {
      expect(findHoleCardLeaks(client, hands), `User ${String(client.userId)}`).toEqual([]);
    }
    // Eigene Karten kamen an.
    const ownCards = a.messages.some(
      (m) =>
        m.type === 'table.state' &&
        (handOf(m.table)?.players.find((p) => p.playerId === '1')?.holeCards?.length ?? 0) === 2,
    );
    expect(ownCards).toBe(true);
    // Keine Fehler bei den Bots.
    expect([a, b, c].flatMap((cl) => cl.errors())).toEqual([]);
  }, 30_000);

  it('Pause nach jeder Hand ist konfigurierbar (hier 0) und die nächste Hand startet automatisch', async () => {
    const { url } = await start();
    const { a, b, c, id } = await threePlayers(url, { ...FAST, startingStack: 2000 });
    a.send({ type: 'table.start', tableId: id });
    const s1 = await a.nextState((t) => handOf(t)?.handNumber === 1);
    const hand = handOf(s1.table);
    expect(hand?.phase).toBe('betting');
    // Alle folden bis auf einen → Hand 2 startet sofort.
    const actor = [a, b, c];
    for (let i = 0; i < 2; i++) {
      const state = actor[0]?.latestState();
      const h = handOf(state);
      const toAct = actor.find((cl) => String(cl.userId) === h?.toActId);
      if (toAct === undefined || h === null) throw new Error('niemand am Zug');
      toAct.send({
        type: 'table.action',
        tableId: id,
        handNumber: h.handNumber,
        seq: h.actionSeq,
        action: { type: 'fold' },
      });
      await a.nextState((t) => (handOf(t)?.actionSeq ?? 0) > h.actionSeq || (handOf(t)?.handNumber ?? 0) > 1);
    }
    await a.nextState((t) => handOf(t)?.handNumber === 2);
  });
});

describe('Ungültige und unerlaubte Nachrichten stören den Tisch nicht', () => {
  it('Aktionen: nicht am Zug, veraltet, falsche Beträge, Zuschauer – Fehler nur an den Absender', async () => {
    const { url } = await start();
    const { a, b, c, id } = await threePlayers(url, { ...FAST, startingStack: 2000 });
    const spectator = await connect(url, 9);
    spectator.send({ type: 'table.join', tableId: id });
    await spectator.nextState();
    a.send({ type: 'table.start', tableId: id });
    const state = (await a.nextState((t) => handOf(t)?.phase === 'betting')).table;
    const hand = handOf(state);
    if (hand === null) throw new Error('keine Hand');
    const players = [a, b, c];
    const toAct = players.find((p) => String(p.userId) === hand.toActId);
    const other = players.find((p) => String(p.userId) !== hand.toActId);
    if (toAct === undefined || other === undefined) throw new Error('Spieler fehlt');
    const base = { type: 'table.action', tableId: id, handNumber: hand.handNumber, seq: hand.actionSeq } as const;
    for (const p of [...players, spectator]) p.skip();

    other.send({ ...base, action: { type: 'call' }, requestId: 'n' });
    expect(await other.nextError()).toMatchObject({ code: 'NOT_YOUR_TURN', requestId: 'n', tableId: id });

    toAct.send({ ...base, seq: hand.actionSeq - 1, action: { type: 'call' } });
    expect(await toAct.nextError()).toMatchObject({ code: 'STALE_ACTION' });
    toAct.send({ ...base, handNumber: hand.handNumber + 1, action: { type: 'call' } });
    expect(await toAct.nextError()).toMatchObject({ code: 'STALE_ACTION' });

    toAct.send({ ...base, action: { type: 'raise', amount: 25 } });
    expect(await toAct.nextError()).toMatchObject({ code: 'AMOUNT_TOO_SMALL' });
    toAct.send({ ...base, action: { type: 'raise', amount: 1_000_000 } });
    expect(await toAct.nextError()).toMatchObject({ code: 'AMOUNT_TOO_LARGE' });
    toAct.send({ ...base, action: { type: 'bet', amount: 40 } });
    expect(await toAct.nextError()).toMatchObject({ code: 'ILLEGAL_ACTION' });
    toAct.send({ ...base, action: { type: 'raise', amount: 'viel' } });
    expect(await toAct.nextError()).toMatchObject({ code: 'BAD_MESSAGE' });
    toAct.sendRaw('{"type":"table.action"');
    expect(await toAct.nextError()).toMatchObject({ code: 'BAD_MESSAGE' });

    spectator.send({ ...base, action: { type: 'call' } });
    expect(await spectator.nextError()).toMatchObject({ code: 'NOT_SEATED' });

    // Danach geht es normal weiter.
    toAct.send({ ...base, action: { type: 'call' } });
    const after = await toAct.nextState((t) => (handOf(t)?.actionSeq ?? 0) === hand.actionSeq + 1);
    expect(handOf(after.table)?.toActId).not.toBe(hand.toActId);

    // Doppelklick: dieselbe Aktion noch einmal → veraltet, keine zweite Aktion.
    toAct.send({ ...base, action: { type: 'call' } });
    expect((await toAct.nextError()).code).toMatch(/STALE_ACTION|NOT_YOUR_TURN/);

    // Die anderen haben keine Fehler der Mitspieler bekommen.
    expect(players.filter((p) => p !== toAct && p !== other).flatMap((p) => p.errors())).toEqual([]);
  });

  it('Start nur durch den Ersteller mit ≥ 2 Spielern; danach kein Beitritt und kein Aufstehen', async () => {
    const { url } = await start();
    const a = await connect(url, 1);
    const b = await connect(url, 2);
    const late = await connect(url, 4);
    const { id } = await createTable(a);
    a.send({ type: 'table.sit', tableId: id, seat: 0 });
    await a.nextState((t) => t.seats.length === 1);

    a.send({ type: 'table.start', tableId: id });
    expect(await a.nextError()).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' });

    await joinAndSit(b, id, 1);
    b.send({ type: 'table.sit', tableId: id, seat: 2 });
    expect(await b.nextError()).toMatchObject({ code: 'ALREADY_SEATED' });
    b.send({ type: 'table.start', tableId: id });
    expect(await b.nextError()).toMatchObject({ code: 'NOT_CREATOR' });

    late.send({ type: 'table.sit', tableId: id, seat: 3 });
    expect(await late.nextError()).toMatchObject({ code: 'NOT_AT_TABLE' });
    late.send({ type: 'table.join', tableId: id });
    await late.nextState();

    a.send({ type: 'table.start', tableId: id });
    await a.nextState((t) => t.status === 'running' && handOf(t) !== null);

    late.send({ type: 'table.sit', tableId: id, seat: 3 });
    expect(await late.nextError()).toMatchObject({ code: 'ROUND_STARTED' });
    b.send({ type: 'table.stand', tableId: id });
    expect(await b.nextError()).toMatchObject({ code: 'ROUND_STARTED' });
    a.send({ type: 'table.start', tableId: id });
    expect(await a.nextError()).toMatchObject({ code: 'ROUND_STARTED' });

    // Zuschauer bekommt den laufenden Zustand ohne Karten.
    const view = late.latestState();
    expect(view?.you.seat).toBeNull();
    expect(handOf(view)?.players.every((p) => p.holeCards === null)).toBe(true);
  });

  it('9 Plätze (D-007): der 10. Spieler wird abgelehnt, Sitze außerhalb und besetzte Sitze auch', async () => {
    const { url } = await start();
    const players = await Promise.all(Array.from({ length: 10 }, (_, i) => connect(url, i + 1)));
    const [creator] = players;
    if (creator === undefined) throw new Error('kein Client');
    const { id } = await createTable(creator, { name: 'Voll' });
    for (const [seat, p] of players.slice(0, 9).entries()) await joinAndSit(p, id, seat);

    const tenth = players[9] as TestClient;
    tenth.send({ type: 'table.join', tableId: id });
    await tenth.nextState();
    tenth.send({ type: 'table.sit', tableId: id, seat: 4 });
    expect(await tenth.nextError()).toMatchObject({ code: 'TABLE_FULL' });

    creator.send({ type: 'table.create', settings: { name: 'Zu groß', maxSeats: 10 }, requestId: 'big' });
    expect(await creator.nextError()).toMatchObject({ code: 'INVALID_SETTINGS', requestId: 'big' });

    // Kleiner Tisch: Sitz außerhalb, besetzter Sitz.
    const { id: small } = await createTable(creator, { name: 'Klein', maxSeats: 2 });
    tenth.send({ type: 'table.join', tableId: small });
    await tenth.nextState((t) => t.id === small);
    tenth.send({ type: 'table.sit', tableId: small, seat: 2 });
    expect(await tenth.nextError()).toMatchObject({ code: 'INVALID_SEAT' });
    creator.send({ type: 'table.sit', tableId: small, seat: 1 });
    await creator.nextState((t) => t.id === small && t.seats.length === 1);
    tenth.send({ type: 'table.sit', tableId: small, seat: 1 });
    expect(await tenth.nextError()).toMatchObject({ code: 'SEAT_TAKEN' });

    // Der volle Tisch startet trotzdem normal.
    creator.send({ type: 'table.start', tableId: id });
    const running = await creator.nextState((t) => t.id === id && t.status === 'running');
    expect(running.table.seats).toHaveLength(9);
  });

  it('Fehler in einem Hook stören weder den Tisch noch andere Tische', async () => {
    const { url } = await start({
      onHandComplete: () => {
        throw new Error('Hook kaputt');
      },
      onHandStarted: () => Promise.reject(new Error('Hook asynchron kaputt')),
    });
    const { a, b, c, id } = await threePlayers(url);
    for (const [i, client] of [a, b, c].entries()) attachBot(client, id, 200 + i);
    a.send({ type: 'table.start', tableId: id });
    await a.next((m) => m.type === 'table.roundFinished', 20_000);

    // Ein zweiter Tisch funktioniert danach ganz normal.
    const d = await connect(url, 5);
    const { id: second } = await createTable(d);
    d.send({ type: 'table.sit', tableId: second, seat: 0 });
    await d.nextState((t) => t.id === second && t.seats.length === 1);
  }, 30_000);
});

describe('Lobby und private Tische', () => {
  it('Lobby-Updates kommen bei anderen Clients an (erstellen, setzen, starten, Ende)', async () => {
    const { url } = await start();
    const watcher = await connect(url, 8);
    watcher.send({ type: 'lobby.subscribe' });
    expect(await watcher.next((m) => m.type === 'lobby.snapshot')).toEqual({ type: 'lobby.snapshot', tables: [] });

    const a = await connect(url, 1);
    const { id } = await createTable(a);
    const created = await watcher.next<Extract<ServerMessage, { type: 'lobby.update' }>>(
      (m) => m.type === 'lobby.update',
    );
    expect(created.table).toMatchObject({
      id,
      name: 'Schnell',
      status: 'open',
      seated: 0,
      maxSeats: 9,
      blinds: { smallBlind: 10, bigBlind: 20 },
      blindType: 'fixed',
      turnTimeSeconds: 20,
      timeBankSeconds: 60,
      createdBy: { id: 1, username: 'user1' },
    });

    a.send({ type: 'table.sit', tableId: id, seat: 0 });
    await watcher.next((m) => m.type === 'lobby.update' && m.table.seated === 1);

    // Neuer Abonnent bekommt den Tisch im Snapshot.
    const late = await connect(url, 7);
    late.send({ type: 'lobby.subscribe' });
    const snap = await late.next<Extract<ServerMessage, { type: 'lobby.snapshot' }>>(
      (m) => m.type === 'lobby.snapshot',
    );
    expect(snap.tables.map((t) => t.id)).toEqual([id]);

    const b = await connect(url, 2);
    await joinAndSit(b, id, 1);
    await watcher.next((m) => m.type === 'lobby.update' && m.table.seated === 2);
    attachBot(a, id, 1);
    attachBot(b, id, 2);
    a.send({ type: 'table.start', tableId: id });
    await watcher.next((m) => m.type === 'lobby.update' && m.table.status === 'running');
    await watcher.next((m) => m.type === 'lobby.remove' && m.tableId === id, 20_000);

    // Abbestellen: keine weiteren Lobby-Nachrichten.
    watcher.send({ type: 'lobby.unsubscribe' });
    watcher.skip();
    const c = await connect(url, 3);
    await createTable(c);
    await late.next((m) => m.type === 'lobby.update');
    expect(watcher.messages.slice(-1)[0]?.type).not.toBe('lobby.update');
  }, 30_000);

  it('private Tische erscheinen nicht in der Lobby und sind nur per Code erreichbar', async () => {
    const { url } = await start();
    const watcher = await connect(url, 8);
    watcher.send({ type: 'lobby.subscribe' });
    await watcher.next((m) => m.type === 'lobby.snapshot');

    const a = await connect(url, 1);
    const { id, code } = await createTable(a, { ...FAST, isPublic: false });
    const state = await a.nextState((t) => t.id === id);
    expect(state.table.inviteCode).toBe(code);
    expect(state.table.you).toEqual({ userId: 1, seat: null, isCreator: true });

    const b = await connect(url, 2);
    b.send({ type: 'table.join', tableId: id });
    expect(await b.nextError()).toMatchObject({ code: 'TABLE_NOT_FOUND' });
    b.send({ type: 'table.join', inviteCode: 'falscher-code' });
    expect(await b.nextError()).toMatchObject({ code: 'TABLE_NOT_FOUND' });
    b.send({ type: 'table.join', inviteCode: code });
    const joined = await b.nextState((t) => t.id === id);
    expect(joined.table.settings.isPublic).toBe(false);

    // Öffentlicher Tisch zum Vergleich: dieser erscheint.
    const { id: pub } = await createTable(a);
    const update = await watcher.next<Extract<ServerMessage, { type: 'lobby.update' }>>(
      (m) => m.type === 'lobby.update',
    );
    expect(update.table.id).toBe(pub);
    expect(watcher.messages.some((m) => m.type === 'lobby.update' && m.table.id === id)).toBe(false);
  });

  it('table.leave steht vor dem Start auf; verlassene leere Tische verschwinden aus der Lobby', async () => {
    const { url, repository } = await start();
    const watcher = await connect(url, 8);
    watcher.send({ type: 'lobby.subscribe' });
    await watcher.next((m) => m.type === 'lobby.snapshot');
    const a = await connect(url, 1);
    const b = await connect(url, 2);
    const { id } = await createTable(a);
    await joinAndSit(b, id, 4);
    b.send({ type: 'table.leave', tableId: id });
    expect(await b.next((m) => m.type === 'table.left')).toEqual({ type: 'table.left', tableId: id });
    await a.nextState((t) => t.seats.length === 0);

    a.send({ type: 'table.leave', tableId: id });
    await a.next((m) => m.type === 'table.left');
    await watcher.next((m) => m.type === 'lobby.remove' && m.tableId === id);
    await app?.game.idle();
    expect(repository.tables.get(id)?.status).toBe('closed');
    b.send({ type: 'table.join', tableId: id });
    expect(await b.nextError()).toMatchObject({ code: 'TABLE_NOT_FOUND' });
  });

  it('Verbindungsstatus pro Spieler: getrennte Spieler bleiben sitzen, connected = false', async () => {
    const { url } = await start();
    const a = await connect(url, 1);
    const b = await connect(url, 2);
    const { id } = await createTable(a);
    a.send({ type: 'table.sit', tableId: id, seat: 0 });
    await joinAndSit(b, id, 1);
    b.close();
    const state = await a.nextState((t) => t.seats.some((s) => s.user.id === 2 && !s.connected));
    expect(state.table.seats.map((s) => [s.user.id, s.connected])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(app?.game.getTable(id)?.isConnected(2)).toBe(false);
  });
});
