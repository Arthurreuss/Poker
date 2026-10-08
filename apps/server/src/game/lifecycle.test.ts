// WP-015 ohne Netzwerk (ManualClock): „Nochmal“ nach Rundenende (D-020), verwaiste Runden (D-022),
// Aufräumen von Tischen ohne Beobachter und Rückkehr per tableId nach Beitritt über den Einladungscode.
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import { PROTOCOL_VERSION, type ServerMessage, type TableSettingsInput, type TableView } from '@poker/engine/protocol';
import { ManualClock } from './clock';
import {
  DEFAULT_IDLE_TABLE_TIMEOUT_MS,
  DEFAULT_ORPHAN_TIMEOUT_MS,
  GameServer,
  type GameClient,
  type GameServerOptions,
} from './game-server';
import type { GameHooks } from './hooks';
import { InMemoryTableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };
const MINUTE = 60_000;

interface Conn {
  client: GameClient;
  userId: number;
  inbox: ServerMessage[];
}

function setup(options: Partial<GameServerOptions> = {}) {
  const clock = new ManualClock(1_000_000);
  const repository = new InMemoryTableRepository();
  const game = new GameServer({
    repository,
    log: silentLog,
    clock,
    rng: createSeededRng(5),
    handPauseMs: 1000,
    ...options,
  });
  async function connect(userId: number): Promise<Conn> {
    const conn: Conn = { client: undefined as unknown as GameClient, userId, inbox: [] };
    conn.client = game.connect(
      { id: userId, username: `u${String(userId)}` },
      { send: (m) => conn.inbox.push(m), close: () => undefined },
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
  return { game, clock, repository, connect, send, last };
}

type Setup = ReturnType<typeof setup>;

/** Kleine Stacks, feste Blinds: eine Runde ist schnell vorbei. */
const QUICK: TableSettingsInput = {
  name: 'Nochmal',
  startingStack: 40,
  blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
};

/** Tisch mit `players` Spielern (User 1 = Ersteller, Sitz i − 1), gestartet. */
async function started(s: Setup, players: number, settings: TableSettingsInput = QUICK) {
  const conns: Conn[] = [];
  for (let u = 1; u <= players; u++) conns.push(await s.connect(u));
  const creator = conns[0] as Conn;
  await s.send(creator, { type: 'table.create', settings });
  const id = s.last(creator).id;
  for (const [i, c] of conns.entries()) {
    if (i > 0) await s.send(c, { type: 'table.join', tableId: id });
    await s.send(c, { type: 'table.sit', tableId: id, seat: i });
  }
  await s.send(creator, { type: 'table.start', tableId: id });
  return { id, conns, creator };
}

/** Alle gehen all-in bzw. callen, bis die Runde vorbei ist. */
async function playToEnd(s: Setup, id: number, conns: Conn[]): Promise<void> {
  const creator = conns[0] as Conn;
  for (let steps = 0; s.last(creator).status === 'running'; steps++) {
    if (steps > 500) throw new Error('Runde endet nicht');
    const hand = s.last(creator).round?.hand;
    if (hand === null || hand === undefined || hand.phase !== 'betting' || hand.toActId === null) {
      s.clock.advance(1000);
      continue;
    }
    const actor = conns.find((c) => String(c.userId) === hand.toActId) as Conn;
    const legal = s.last(actor).round?.hand?.legalActions;
    const type = legal?.actions.some((a) => a.type === 'allIn') ? 'allIn' : 'call';
    await s.send(actor, {
      type: 'table.action',
      tableId: id,
      handNumber: hand.handNumber,
      seq: hand.actionSeq,
      action: { type },
    });
  }
}

describe('„Nochmal“ nach Rundenende (D-020)', () => {
  it('startet eine neue Runde am selben Tisch mit denselben Spielern', async () => {
    const roundIds: number[] = [];
    const hooks: GameHooks = {
      onRoundComplete: (e) => {
        roundIds.push(e.roundId);
      },
    };
    const s = setup({ hooks });
    const { id, conns, creator } = await started(s, 3);
    await playToEnd(s, id, conns);
    await s.game.idle();

    const done = s.last(creator);
    expect(done.status).toBe('finished');
    expect(done.round?.standings).toHaveLength(3);
    expect(conns.every((c) => c.inbox.some((m) => m.type === 'table.roundFinished'))).toBe(true);
    // Tisch bleibt nach Rundenende bestehen (Zustand „Runde beendet“), in der DB vorerst geschlossen.
    expect(s.game.getTable(id)?.status).toBe('finished');
    expect(s.repository.tables.get(id)?.status).toBe('closed');

    // Nur der Ersteller darf.
    const other = conns[1] as Conn;
    await s.send(other, { type: 'table.rematch', tableId: id, requestId: 'n' });
    expect(errors(other).at(-1)).toMatchObject({ code: 'NOT_CREATOR', requestId: 'n', tableId: id });

    await s.send(creator, { type: 'table.rematch', tableId: id });
    const again = s.last(creator);
    expect(again.id).toBe(id);
    expect(again.status).toBe('running');
    expect(again.round?.handNumber).toBe(1);
    expect(again.round?.hand?.players.map((p) => p.startStack)).toEqual([40, 40, 40]);
    expect(again.seats.map((x) => [x.seat, x.user.id])).toEqual(done.seats.map((x) => [x.seat, x.user.id]));
    expect(again.round?.players.map((p) => p.id).sort()).toEqual(['1', '2', '3']);
    expect(again.round?.players.every((p) => p.placement === null)).toBe(true);
    expect(again.seats.every((x) => x.timeBankMs === 60_000)).toBe(true);
    // Neue Runde in der DB, Tisch wieder laufend.
    expect(s.repository.rounds.size).toBe(2);
    expect([...s.repository.rounds.values()].map((r) => r.status)).toEqual(['finished', 'running']);
    expect(s.repository.tables.get(id)?.status).toBe('running');

    // Auch die zweite Runde lässt sich zu Ende spielen und wieder „nochmal“ starten.
    await playToEnd(s, id, conns);
    await s.game.idle();
    expect(roundIds).toEqual([1, 2]);
    await s.send(creator, { type: 'table.rematch', tableId: id });
    expect(s.last(creator).status).toBe('running');
    expect(s.repository.rounds.size).toBe(3);
  });

  it('nicht während der Runde oder vor dem Start', async () => {
    const s = setup();
    const a = await s.connect(1);
    await s.send(a, { type: 'table.create', settings: QUICK });
    const id = s.last(a).id;
    await s.send(a, { type: 'table.rematch', tableId: id });
    expect(errors(a).at(-1)).toMatchObject({ code: 'ROUND_NOT_FINISHED' });

    const t = await started(s, 2);
    await s.send(t.creator, { type: 'table.rematch', tableId: t.id });
    expect(errors(t.creator).at(-1)).toMatchObject({ code: 'ROUND_NOT_FINISHED' });
    await s.send(t.creator, { type: 'table.start', tableId: t.id });
    expect(errors(t.creator).at(-1)).toMatchObject({ code: 'ROUND_STARTED' });
  });

  it('beendeter Tisch: bleibt nach einem Verbindungsabbruch, verschwindet nach dem Leerlauf-Timeout', async () => {
    const s = setup();
    const { id, conns } = await started(s, 2);
    await playToEnd(s, id, conns);
    for (const c of conns) s.game.disconnect(c.client);
    expect(s.game.getTable(id)).toBeDefined();

    // Ersteller kommt zurück (Reload); allein reicht es nicht für „Nochmal“ (D-024: nur verbundene spielen).
    const back = await s.connect(1);
    await s.send(back, { type: 'table.join', tableId: id });
    s.clock.advance(DEFAULT_IDLE_TABLE_TIMEOUT_MS);
    expect(s.game.getTable(id)).toBeDefined();
    await s.send(back, { type: 'table.rematch', tableId: id });
    expect(errors(back).at(-1)).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS', tableId: id });
    expect(s.last(back).seats).toHaveLength(2);

    // Der zweite Spieler kommt auch zurück → „Nochmal“ klappt.
    const back2 = await s.connect(2);
    await s.send(back2, { type: 'table.join', tableId: id });
    await s.send(back, { type: 'table.rematch', tableId: id });
    expect(s.last(back).status).toBe('running');
    expect(s.last(back).you.isCreator).toBe(true);
  });

  it('getrennte Spieler stehen bei „Nochmal“ automatisch auf; es spielen nur verbundene (D-024)', async () => {
    const s = setup();
    const { id, conns, creator } = await started(s, 3);
    await playToEnd(s, id, conns);
    await s.game.idle();

    // Spieler 3 trennt sich nach Rundenende (Tab zu, Netz weg).
    const gone = conns[2] as Conn;
    s.game.disconnect(gone.client);
    expect(s.last(creator).seats.find((x) => x.user.id === 3)?.connected).toBe(false);

    await s.send(creator, { type: 'table.rematch', tableId: id });
    const again = s.last(creator);
    expect(again.status).toBe('running');
    expect(again.seats.map((x) => [x.seat, x.user.id])).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(again.round?.players.map((p) => p.id).sort()).toEqual(['1', '2']);
    expect(s.game.getTable(id)?.seatOf(3)).toBeNull();
    // In der DB hat die neue Runde nur die verbundenen Teilnehmer.
    const latest = [...s.repository.rounds.values()].at(-1);
    expect(latest?.status).toBe('running');
    expect(latest?.players.map((p) => p.userId).sort()).toEqual([1, 2]);

    // Die neue Runde läuft normal zu Ende.
    await playToEnd(s, id, conns.slice(0, 2));
    expect(s.last(creator).status).toBe('finished');
  });

  it('„Nochmal“ mit weniger als 2 verbundenen Spielern: NOT_ENOUGH_PLAYERS, niemand steht auf', async () => {
    const s = setup();
    const { id, conns, creator } = await started(s, 2);
    await playToEnd(s, id, conns);
    s.game.disconnect((conns[1] as Conn).client);
    await s.send(creator, { type: 'table.rematch', tableId: id, requestId: 'r' });
    expect(errors(creator).at(-1)).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS', requestId: 'r', tableId: id });
    expect(s.game.getTable(id)?.status).toBe('finished');
    expect(s.game.getTable(id)?.seats.size).toBe(2);
  });

  it('beendeter Tisch: explizit verlassen → sofort weg; ohne Beobachter → nach dem Timeout weg', async () => {
    const s = setup();
    const first = await started(s, 2);
    await playToEnd(s, first.id, first.conns);
    for (const c of first.conns) {
      await s.send(c, { type: 'table.leave', tableId: first.id });
    }
    expect(s.game.getTable(first.id)).toBeUndefined();

    const s2 = setup();
    const second = await started(s2, 2);
    await playToEnd(s2, second.id, second.conns);
    for (const c of second.conns) s2.game.disconnect(c.client);
    s2.clock.advance(DEFAULT_IDLE_TABLE_TIMEOUT_MS - 1);
    expect(s2.game.getTable(second.id)).toBeDefined();
    s2.clock.advance(1);
    expect(s2.game.getTable(second.id)).toBeUndefined();
  });
});

describe('Verwaiste Runden (D-022)', () => {
  it('10 Minuten kein Spieler verbunden → Runde aborted ohne Punkte, Tisch closed, Zuschauer informiert', async () => {
    const s = setup();
    const lobby = await s.connect(9);
    await s.send(lobby, { type: 'lobby.subscribe' });
    const { id, conns } = await started(s, 2, { ...QUICK, startingStack: 100_000 });
    const spectator = await s.connect(8);
    await s.send(spectator, { type: 'table.join', tableId: id });
    expect(lobby.inbox.some((m) => m.type === 'lobby.update' && m.table.status === 'running')).toBe(true);

    for (const c of conns) s.game.disconnect(c.client);
    // Die Runde läuft allein weiter (Auto-Check/Fold), bis die Frist abgelaufen ist.
    s.clock.advance(DEFAULT_ORPHAN_TIMEOUT_MS - 1);
    expect(s.game.getTable(id)?.status).toBe('running');
    s.clock.advance(1);

    expect(s.game.getTable(id)).toBeUndefined();
    expect(spectator.inbox.at(-1)).toEqual({ type: 'table.closed', tableId: id, reason: 'abandoned' });
    expect(lobby.inbox.at(-1)).toEqual({ type: 'lobby.remove', tableId: id });
    await s.game.idle();
    const round = [...s.repository.rounds.values()][0];
    expect(round?.status).toBe('aborted');
    expect(round?.players.every((p) => p.placement === null && p.points === null)).toBe(true);
    expect(s.repository.tables.get(id)?.status).toBe('closed');

    // Keine weiteren Spielschritte, Tisch nicht mehr erreichbar.
    expect(s.clock.pendingCount).toBe(0);
    await s.send(spectator, { type: 'table.join', tableId: id });
    expect(errors(spectator).at(-1)).toMatchObject({ code: 'TABLE_NOT_FOUND' });
  });

  it('ein Spieler kommt zwischendurch zurück → die Frist beginnt von vorn', async () => {
    const s = setup();
    const { id, conns } = await started(s, 2, { ...QUICK, startingStack: 100_000 });
    for (const c of conns) s.game.disconnect(c.client);
    s.clock.advance(9 * MINUTE);

    const back = await s.connect(2);
    await s.send(back, { type: 'table.join', tableId: id });
    s.clock.advance(5 * MINUTE);
    expect(s.game.getTable(id)?.status).toBe('running');

    s.game.disconnect(back.client);
    s.clock.advance(10 * MINUTE - 1);
    expect(s.game.getTable(id)?.status).toBe('running');
    s.clock.advance(1);
    expect(s.game.getTable(id)).toBeUndefined();
  });

  it('Zuschauer zählen nicht als verbundene Spieler; konfigurierbare Frist', async () => {
    const s = setup({ orphanTimeoutMs: 2 * MINUTE });
    const { id, conns } = await started(s, 2, { ...QUICK, startingStack: 100_000 });
    const spectator = await s.connect(7);
    await s.send(spectator, { type: 'table.join', tableId: id });
    for (const c of conns) await s.send(c, { type: 'table.leave', tableId: id });
    s.clock.advance(2 * MINUTE);
    expect(s.game.getTable(id)).toBeUndefined();
    expect(spectator.inbox.at(-1)).toMatchObject({ type: 'table.closed' });
  });

  it('eine beendete Runde wird nicht abgebrochen', async () => {
    const s = setup();
    const { id, conns } = await started(s, 2);
    await playToEnd(s, id, conns);
    const spectator = await s.connect(7);
    await s.send(spectator, { type: 'table.join', tableId: id });
    for (const c of conns) s.game.disconnect(c.client);
    s.clock.advance(DEFAULT_ORPHAN_TIMEOUT_MS);
    await s.game.idle();
    expect(s.game.getTable(id)?.status).toBe('finished');
    expect([...s.repository.rounds.values()][0]?.status).toBe('finished');
  });
});

describe('Offene Tische und Einladungscode (WP-015)', () => {
  it('Verbindungsabbruch des Erstellers schließt den offenen Tisch nicht sofort (Lobby → Tischseite)', async () => {
    const s = setup();
    const a = await s.connect(1);
    await s.send(a, { type: 'table.create', settings: { ...QUICK, isPublic: false } });
    const id = s.last(a).id;
    s.game.disconnect(a.client);
    s.clock.advance(DEFAULT_IDLE_TABLE_TIMEOUT_MS - 1);
    const again = await s.connect(1);
    await s.send(again, { type: 'table.join', tableId: id });
    expect(s.last(again).id).toBe(id);
    s.game.disconnect(again.client);
    s.clock.advance(DEFAULT_IDLE_TABLE_TIMEOUT_MS);
    expect(s.game.getTable(id)).toBeUndefined();
    expect(s.repository.tables.get(id)?.status).toBe('closed');
  });

  it('wer per Code beigetreten ist, darf den privaten Tisch danach auch per tableId betreten', async () => {
    const s = setup();
    const a = await s.connect(1);
    await s.send(a, { type: 'table.create', settings: { ...QUICK, isPublic: false } });
    const { id, inviteCode } = s.last(a);
    const b = await s.connect(2);
    await s.send(b, { type: 'table.join', tableId: id });
    expect(errors(b).at(-1)).toMatchObject({ code: 'TABLE_NOT_FOUND' });
    await s.send(b, { type: 'table.join', inviteCode });
    expect(s.last(b).id).toBe(id);

    // Neue Verbindung (z. B. Tischseite nach der Einladungsseite): per tableId erlaubt.
    const b2 = await s.connect(2);
    await s.send(b2, { type: 'table.join', tableId: id });
    expect(s.last(b2).id).toBe(id);
    expect(errors(b2)).toEqual([]);
  });
});

function errors(c: Conn) {
  return c.inbox.filter((m) => m.type === 'error');
}
