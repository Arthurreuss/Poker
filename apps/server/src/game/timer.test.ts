// WP-012 ohne Netzwerk: Zug-Timer, Zeitbank, getrennte Spieler und Ablösung durch eine neuere Verbindung.
// Alle Zeit läuft über `ManualClock` – kein echtes Warten.
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import {
  CLOSE_REPLACED,
  PROTOCOL_VERSION,
  type ServerMessage,
  type TableSettingsInput,
  type TableView,
} from '@poker/engine/protocol';
import { ManualClock } from './clock';
import { DEFAULT_DISCONNECT_GRACE_MS, GameServer, type GameClient } from './game-server';
import { InMemoryTableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };
const T0 = 1_000_000;
const TURN = 20_000;
const BANK = 60_000;
const GRACE = DEFAULT_DISCONNECT_GRACE_MS;

interface Conn {
  client: GameClient;
  userId: number;
  inbox: ServerMessage[];
  closed: { code: number; reason: string } | null;
}

function setup() {
  const clock = new ManualClock(T0);
  const game = new GameServer({
    repository: new InMemoryTableRepository(),
    log: silentLog,
    clock,
    rng: createSeededRng(7),
    handPauseMs: 3000,
  });
  async function connect(userId: number): Promise<Conn> {
    const conn: Conn = { client: undefined as unknown as GameClient, userId, inbox: [], closed: null };
    conn.client = game.connect(
      { id: userId, username: `u${String(userId)}` },
      {
        send: (m) => conn.inbox.push(m),
        close: (code, reason) => {
          conn.closed = { code, reason };
        },
      },
    );
    await game.handle(conn.client, JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION }));
    return conn;
  }
  const send = (c: Conn, msg: object) => game.handle(c.client, JSON.stringify(msg));
  const last = (c: Conn): TableView => {
    for (let i = c.inbox.length - 1; i >= 0; i--) {
      const m = c.inbox[i] as ServerMessage;
      if (m.type === 'table.state') return m.table;
    }
    throw new Error('kein Zustand');
  };
  /** Frische Sicht direkt vom Tisch (ohne auf eine Sendung zu warten), z. B. für die laufende Zeitbank. */
  const view = (tableId: number, userId: number): TableView => {
    const table = game.getTable(tableId);
    if (table === undefined) throw new Error('Tisch fehlt');
    return table.view({ id: userId, username: `u${String(userId)}` });
  };
  const act = (c: Conn, tableId: number, action: object) => {
    const hand = last(c).round?.hand;
    return send(c, { type: 'table.action', tableId, handNumber: hand?.handNumber, seq: hand?.actionSeq, action });
  };
  return { game, clock, connect, send, last, view, act };
}

type Setup = ReturnType<typeof setup>;

const FIXED: TableSettingsInput = {
  name: 'Timer',
  startingStack: 1000,
  blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
};

/** Startet einen Tisch; Spieler i bekommt Sitz i − 1, User 1 ist Ersteller. */
async function started(s: Setup, players: number, settings: TableSettingsInput = FIXED) {
  const conns: Conn[] = [];
  for (let u = 1; u <= players; u++) conns.push(await s.connect(u));
  const [creator] = conns as [Conn];
  await s.send(creator, { type: 'table.create', settings });
  const id = s.last(creator).id;
  for (const [i, c] of conns.entries()) {
    if (i > 0) await s.send(c, { type: 'table.join', tableId: id });
    await s.send(c, { type: 'table.sit', tableId: id, seat: i });
  }
  await s.send(creator, { type: 'table.start', tableId: id });
  const byUser = (userId: number): Conn => conns[userId - 1] as Conn;
  const actor = (): Conn => byUser(Number(s.last(creator).round?.hand?.toActId));
  return { id, conns, creator, byUser, actor };
}

const seatOf = (v: TableView, userId: number) => v.seats.find((x) => x.user.id === userId);
const lastEvent = (v: TableView) => v.round?.hand?.log.at(-1);

describe('Zug-Timer und Zeitbank (D-013)', () => {
  it('meldet Deadline, Zeitbank und Server-Uhr in table.state', async () => {
    const s = setup();
    const { creator, actor } = await started(s, 2);
    const v = s.last(creator);
    const a = actor();
    expect(v.serverNowMs).toBe(T0);
    expect(v.turnClock).toEqual({
      playerId: String(a.userId),
      seat: a.userId - 1,
      handNumber: 1,
      actionSeq: v.round?.hand?.actionSeq,
      startedAtMs: T0,
      turnEndsAtMs: T0 + TURN,
      deadlineMs: T0 + TURN + BANK,
    });
    expect(v.seats.map((x) => x.timeBankMs)).toEqual([BANK, BANK]);
  });

  it('Ablauf → Fold (Check nicht erlaubt), Zeitbank vollständig verbraucht; nächster Zug ohne Zeitbank', async () => {
    const s = setup();
    const { id, creator, actor } = await started(s, 2);
    const a = actor(); // Heads-up preflop: Button/Small Blind muss callen → Check nicht möglich
    const sent = creator.inbox.length;

    s.clock.advance(TURN);
    expect(creator.inbox.length).toBe(sent); // Wechsel in die Zeitbank sendet nichts – die Deadline steht schon fest
    s.clock.advance(30_000);
    expect(seatOf(s.view(id, 1), a.userId)?.timeBankMs).toBe(BANK - 30_000);
    expect(s.last(creator).round?.hand?.phase).toBe('betting');

    s.clock.advance(BANK - 30_000 - 1);
    expect(s.last(creator).round?.hand?.phase).toBe('betting');
    s.clock.advance(1);
    const after = s.last(creator);
    expect(after.round?.hand?.phase).toBe('complete');
    expect(lastEvent(after)).toMatchObject({ type: 'fold', playerId: String(a.userId) });
    expect(seatOf(after, a.userId)?.timeBankMs).toBe(0);
    expect(after.turnClock).toBeNull();

    // Nächste Hand: wer die Zeitbank aufgebraucht hat, hat nur noch die normale Zugzeit.
    s.clock.advance(3000);
    const v2 = s.last(creator);
    expect(v2.round?.handNumber).toBe(2);
    const clock2 = v2.turnClock;
    expect(clock2).not.toBeNull();
    if (clock2?.playerId === String(a.userId)) {
      expect(clock2.deadlineMs).toBe(clock2.turnEndsAtMs);
    } else {
      expect(clock2?.deadlineMs).toBe((clock2?.turnEndsAtMs ?? 0) + BANK);
    }
  });

  it('Ablauf → Check, wenn erlaubt; nur die verbrauchte Zeitbank wird abgezogen', async () => {
    const s = setup();
    const { id, creator, actor } = await started(s, 2);
    const sb = actor();
    await s.act(sb, id, { type: 'call' }); // innerhalb der Zugzeit → kostet keine Zeitbank
    const bb = actor();
    expect(bb).not.toBe(sb);
    const start = s.last(creator).turnClock;
    expect(start?.startedAtMs).toBe(T0);

    s.clock.advance(TURN + 5000); // 5 s Zeitbank verbraucht, dann eigene Aktion
    await s.act(bb, id, { type: 'check' });
    let v = s.last(creator);
    expect(v.round?.hand?.street).toBe('flop');
    expect(seatOf(v, bb.userId)?.timeBankMs).toBe(BANK - 5000);
    expect(seatOf(v, sb.userId)?.timeBankMs).toBe(BANK);

    // Postflop ist der Big Blind zuerst dran; diesmal läuft alles ab → automatischer Check.
    expect(actor()).toBe(bb);
    expect(v.turnClock?.deadlineMs).toBe(T0 + TURN + 5000 + TURN + BANK - 5000);
    s.clock.advance(TURN + BANK - 5000);
    v = s.last(creator);
    expect(lastEvent(v)).toMatchObject({ type: 'check', playerId: String(bb.userId) });
    expect(v.round?.hand?.phase).toBe('betting');
    expect(seatOf(v, bb.userId)?.timeBankMs).toBe(0);
    expect(actor()).toBe(sb);
  });

  it('Zeitbank 0: automatische Aktion direkt nach der Zugzeit', async () => {
    const s = setup();
    const { creator, actor } = await started(s, 2, { ...FIXED, turnTimeSeconds: 5, timeBankSeconds: 0 });
    const a = actor();
    expect(s.last(creator).turnClock?.deadlineMs).toBe(T0 + 5000);
    s.clock.advance(5000);
    expect(lastEvent(s.last(creator))).toMatchObject({ type: 'fold', playerId: String(a.userId) });
  });
});

describe('Getrennte Spieler (D-012)', () => {
  it('Spieler am Zug trennt sich → nach der Gnadenfrist Check/Fold, ohne Zeitbank zu verbrauchen', async () => {
    const s = setup();
    const { id, creator, actor } = await started(s, 3);
    const a = actor();
    expect(a).not.toBe(creator);
    s.clock.advance(1000);
    s.game.disconnect(a.client);
    const v = s.last(creator);
    expect(seatOf(v, a.userId)?.connected).toBe(false);
    expect(v.turnClock?.deadlineMs).toBe(T0 + 1000 + GRACE);

    s.clock.advance(GRACE - 1);
    expect(s.last(creator).round?.hand?.actionSeq).toBe(v.round?.hand?.actionSeq);
    s.clock.advance(1);
    const after = s.last(creator);
    expect(lastEvent(after)).toMatchObject({ type: 'fold', playerId: String(a.userId) });
    expect(seatOf(s.view(id, 1), a.userId)?.timeBankMs).toBe(BANK);
  });

  it('wer schon getrennt ist, wenn er an die Reihe kommt, wird nach der Gnadenfrist automatisch gecheckt/gefoldet', async () => {
    const s = setup();
    const { id, creator, byUser, actor } = await started(s, 3);
    // Den, der nach dem aktuellen Spieler dran ist, vorher trennen.
    const first = actor();
    const order = s.last(creator).round?.hand?.players.map((p) => Number(p.playerId)) ?? [];
    const next = byUser(order[(order.indexOf(first.userId) + 1) % order.length] ?? 0);
    s.game.disconnect(next.client);
    await s.act(first, id, { type: 'call' });
    expect(actor()).toBe(next);
    expect(s.last(creator).turnClock?.deadlineMs).toBe(T0 + GRACE);
    s.clock.advance(GRACE);
    expect(lastEvent(s.last(creator))).toMatchObject({ playerId: String(next.userId) });
  });

  it('Tisch blockiert nie: alle getrennt → die Runde läuft mit Blinds bis zum Ende', async () => {
    const s = setup();
    const settings: TableSettingsInput = {
      name: 'Alle weg',
      startingStack: 300,
      blindStructure: {
        type: 'increasing',
        levelMinutes: 1,
        levels: [
          { smallBlind: 10, bigBlind: 20 },
          { smallBlind: 50, bigBlind: 100 },
          { smallBlind: 200, bigBlind: 400 },
          // Letztes Level über allen Chips (wie die Standard-Struktur): Blinds erzwingen All-ins → Ende.
          { smallBlind: 1000, bigBlind: 2000 },
        ],
      },
    };
    const { id, conns } = await started(s, 3, settings);
    const watcher = await s.connect(9); // Zuschauer sieht das Ende
    await s.send(watcher, { type: 'table.join', tableId: id });
    for (const c of conns) s.game.disconnect(c.client);

    // Getrennte Spieler zahlen Blinds: in jeder neuen Hand stehen Blinds im Log.
    const blindsPosted = new Set<number>();
    for (let i = 0; i < 2000 && s.last(watcher).status !== 'finished'; i++) {
      s.clock.advance(1000);
      const hand = s.last(watcher).round?.hand;
      if (hand?.log.some((e) => e.type === 'bigBlind')) blindsPosted.add(hand.handNumber);
    }
    const end = s.last(watcher);
    expect(end.status).toBe('finished');
    expect(end.round?.standings).toHaveLength(3);
    expect(blindsPosted.size).toBeGreaterThan(1);
    expect(watcher.inbox.some((m) => m.type === 'table.roundFinished')).toBe(true);
  });

  it('Reconnect innerhalb der Gnadenfrist: volle Frist zurück, identischer Zustand inkl. eigener Karten', async () => {
    const s = setup();
    const { id, creator, actor } = await started(s, 2);
    const a = actor();
    const before = s.last(a);
    s.game.disconnect(a.client);
    s.clock.advance(GRACE - 1);

    const again = await s.connect(a.userId);
    await s.send(again, { type: 'table.join', tableId: id });
    const after = s.last(again);
    const strip = (v: TableView) => ({ ...v, serverNowMs: 0, seats: v.seats.map((x) => ({ ...x, timeBankMs: 0 })) });
    expect(strip(after)).toEqual(strip(before));
    expect(after.round?.hand?.players.find((p) => p.playerId === String(a.userId))?.holeCards).toHaveLength(2);
    expect(after.turnClock?.deadlineMs).toBe(T0 + TURN + BANK);
    expect(seatOf(s.last(creator), a.userId)?.connected).toBe(true);

    s.clock.advance(TURN); // ohne Reconnect wäre längst gefoldet
    expect(s.last(creator).round?.hand?.actionSeq).toBe(before.round?.hand?.actionSeq);
  });
});

describe('Zwei Verbindungen desselben Users', () => {
  it('die neuere übernimmt, die ältere wird mit 4001 geschlossen und ignoriert', async () => {
    const s = setup();
    const { id, byUser, actor } = await started(s, 2);
    const a = actor();
    const other = byUser(a.userId === 1 ? 2 : 1);
    const newer = await s.connect(a.userId);
    expect(a.closed).toEqual({ code: CLOSE_REPLACED, reason: expect.any(String) as string });
    expect(newer.closed).toBeNull();
    expect(newer.inbox.map((m) => m.type)).toEqual(['welcome']);

    // Die alte Verbindung bekommt nichts mehr und kann nicht mehr handeln.
    const oldCount = a.inbox.length;
    await s.act(a, id, { type: 'fold' });
    expect(a.inbox.length).toBe(oldCount);
    expect(s.last(other).round?.hand?.actionSeq).toBe(s.last(a).round?.hand?.actionSeq);
    expect(seatOf(s.last(other), a.userId)?.connected).toBe(false);

    await s.send(newer, { type: 'table.join', tableId: id });
    expect(seatOf(s.last(other), a.userId)?.connected).toBe(true);
    await s.act(newer, id, { type: 'fold' });
    expect(s.last(other).round?.hand?.phase).toBe('complete');
    s.game.disconnect(a.client); // späteres close-Ereignis der alten Verbindung ändert nichts
    expect(seatOf(s.last(other), a.userId)?.connected).toBe(true);
  });

  it('ping → pong mit Server-Uhr, auch vor hello', async () => {
    const s = setup();
    const inbox: ServerMessage[] = [];
    const c = s.game.connect({ id: 5, username: 'u5' }, { send: (m) => inbox.push(m), close: () => undefined });
    s.clock.advance(42);
    await s.game.handle(c, JSON.stringify({ type: 'ping', requestId: 'hb' }));
    expect(inbox).toEqual([{ type: 'pong', requestId: 'hb', serverNowMs: T0 + 42 }]);
  });
});
