// Admin zieht neue eigene Karten (WP-035, D-032) – Regeln ohne Netzwerk und ohne DB: GameServer mit In-Memory-
// Verbindungen und ManualClock, Admin-Protokoll als Fake-Senke.
import { describe, expect, it } from 'vitest';
import { createSeededRng, type Card } from '@poker/engine';
import { PROTOCOL_VERSION, type ServerMessage } from '@poker/engine/protocol';
import type { CardRedrawAudit, CardRedrawAuditSink } from './admin-reveal';
import { ManualClock } from './clock';
import { GameServer, type GameClient } from './game-server';
import { InMemoryTableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };
const ADMIN = 1;

type ErrorMessage = Extract<ServerMessage, { type: 'error' }>;

function setup(audit?: CardRedrawAuditSink) {
  const audits: CardRedrawAudit[] = [];
  const game = new GameServer({
    repository: new InMemoryTableRepository(),
    log: silentLog,
    clock: new ManualClock(1_000_000),
    rng: createSeededRng(5),
    handPauseMs: 3000,
    redrawAudit:
      audit ??
      ((entry) => {
        audits.push(entry);
        return Promise.resolve(true);
      }),
  });
  const inbox = new Map<number, ServerMessage[]>();
  async function client(userId: number, isAdmin = false): Promise<GameClient> {
    const box: ServerMessage[] = [];
    inbox.set(userId, box);
    const c = game.connect(
      { id: userId, username: `u${String(userId)}` },
      { send: (m) => box.push(m), close: () => undefined },
      { isAdmin },
    );
    await game.handle(c, JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION }));
    return c;
  }
  const send = (c: GameClient, msg: object) => game.handle(c, JSON.stringify(msg));
  const box = (userId: number) => inbox.get(userId) ?? [];
  return { game, audits, client, send, box };
}

/** Admin (User 1) auf Sitz 0, Spieler 2 und 3 auf Sitz 3 und 6, Zuschauer 9; Runde gestartet. */
async function running(s: ReturnType<typeof setup>) {
  const admin = await s.client(ADMIN, true);
  const b = await s.client(2);
  const c = await s.client(3);
  const spectator = await s.client(9);
  await s.send(b, { type: 'table.create', settings: { name: 'T', startingStack: 1000 } });
  const id = s.game.tableIds()[0] ?? 0;
  await s.send(b, { type: 'table.sit', tableId: id, seat: 3 });
  await s.send(admin, { type: 'table.join', tableId: id });
  await s.send(admin, { type: 'table.sit', tableId: id, seat: 0 });
  await s.send(c, { type: 'table.join', tableId: id });
  await s.send(c, { type: 'table.sit', tableId: id, seat: 6 });
  await s.send(spectator, { type: 'table.join', tableId: id });
  await s.send(b, { type: 'table.start', tableId: id });
  return {
    admin,
    b,
    c,
    spectator,
    id,
    clients: new Map([
      [ADMIN, admin],
      [2, b],
      [3, c],
    ]),
  };
}

function hand(s: ReturnType<typeof setup>, tableId: number) {
  const h = s.game.getTable(tableId)?.round?.hand;
  if (h === null || h === undefined) throw new Error('keine Hand');
  return h;
}

function cardsOf(s: ReturnType<typeof setup>, tableId: number, userId: number): Card[] {
  return [...(hand(s, tableId).players.find((p) => p.id === String(userId))?.holeCards ?? [])];
}

const redraw = (tableId: number) => ({ type: 'admin.redrawCards', tableId, requestId: 'redraw:1' });

describe('admin.redrawCards', () => {
  it('tauscht die Karten des Admins; nur er bekommt eine neue Sicht, protokolliert wird jedes Mal', async () => {
    const s = setup();
    const t = await running(s);
    const before = cardsOf(s, t.id, ADMIN);
    const others = [...cardsOf(s, t.id, 2), ...cardsOf(s, t.id, 3)];
    const counts = [2, 3, 9].map((u) => s.box(u).length);

    for (let i = 0; i < 30; i++) await s.send(t.admin, redraw(t.id));

    const after = cardsOf(s, t.id, ADMIN);
    expect(after).not.toEqual(before);
    for (const card of after) expect(others.includes(card)).toBe(false);
    const h = hand(s, t.id);
    const all = [...h.players.flatMap((p) => p.holeCards), ...h.board, ...h.burned, ...h.deck];
    expect(new Set(all).size).toBe(52);
    expect(all).toHaveLength(52);

    // Admin: neue Sicht mit den neuen Karten.
    const last = s.box(ADMIN).at(-1);
    expect(last?.type).toBe('table.state');
    if (last?.type === 'table.state') {
      expect(last.table.round?.hand?.players.find((p) => p.playerId === '1')?.holeCards).toEqual(after);
    }
    // Mitspieler und Zuschauer: keine einzige Nachricht.
    expect([2, 3, 9].map((u) => s.box(u).length)).toEqual(counts);
    expect(s.audits).toHaveLength(30);
    expect(s.audits[0]).toMatchObject({ adminId: ADMIN, tableId: t.id, seat: 0, handNumber: 1 });
  });

  it('Nicht-Admin, Zuschauer und ohne Protokoll-Senke: FORBIDDEN bzw. NOT_SEATED, nichts ändert sich', async () => {
    const s = setup();
    const t = await running(s);
    const before = cardsOf(s, t.id, 2);
    await s.send(t.b, redraw(t.id));
    expect(s.box(2).at(-1)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    expect(cardsOf(s, t.id, 2)).toEqual(before);

    const admin2 = await s.client(7, true);
    await s.send(admin2, { type: 'table.join', tableId: t.id });
    await s.send(admin2, redraw(t.id));
    expect(s.box(7).at(-1)).toMatchObject({ type: 'error', code: 'NOT_SEATED' });
    expect(s.audits).toHaveLength(0);
  });

  it('verneint die DB das Admin-Recht, bleiben die Karten', async () => {
    const s = setup(() => Promise.resolve(false));
    const t = await running(s);
    const before = cardsOf(s, t.id, ADMIN);
    await s.send(t.admin, redraw(t.id));
    expect(s.box(ADMIN).at(-1)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    expect(cardsOf(s, t.id, ADMIN)).toEqual(before);
  });

  it('gefoldet: ILLEGAL_ACTION', async () => {
    const s = setup();
    const t = await running(s);
    // Bis der Admin dran ist, callen die anderen; dann foldet er.
    for (;;) {
      const h = hand(s, t.id);
      const actor = Number(h.toActId);
      const round = s.game.getTable(t.id)?.round;
      const action = actor === ADMIN ? { type: 'fold' } : { type: 'call' };
      await s.send(t.clients.get(actor) as GameClient, {
        type: 'table.action',
        tableId: t.id,
        handNumber: round?.handNumber,
        seq: h.log.length,
        action,
      });
      if (actor === ADMIN) break;
    }
    expect(hand(s, t.id).phase).toBe('betting');
    await s.send(t.admin, redraw(t.id));
    expect((s.box(ADMIN).at(-1) as ErrorMessage).code).toBe('ILLEGAL_ACTION');
    expect(s.audits).toHaveLength(0);
  });

  it('endet die Hand während des Protokollierens, wird nichts getauscht', async () => {
    let release: (ok: boolean) => void = () => undefined;
    const s = setup(() => new Promise<boolean>((r) => (release = r)));
    const t = await running(s);
    const pending = s.send(t.admin, redraw(t.id));
    // Alle außer einem folden → Hand vorbei.
    for (let i = 0; i < 2; i++) {
      const h = hand(s, t.id);
      await s.send(t.clients.get(Number(h.toActId)) as GameClient, {
        type: 'table.action',
        tableId: t.id,
        handNumber: 1,
        seq: h.log.length,
        action: { type: 'fold' },
      });
    }
    const finished = hand(s, t.id);
    expect(finished.phase).toBe('complete');
    const cards = cardsOf(s, t.id, ADMIN);
    release(true);
    await pending;
    expect((s.box(ADMIN).at(-1) as ErrorMessage).code).toBe('NO_HAND_IN_PROGRESS');
    expect(cardsOf(s, t.id, ADMIN)).toEqual(cards);
  });
});
