// Admin deckt verdeckte Karten auf (WP-033, D-027) – Regeln ohne Netzwerk und ohne DB: GameServer mit In-Memory-
// Verbindungen und ManualClock, Admin-Protokoll als Fake-Senke. Prüft vor allem, dass die Karten nur an die
// anfragende Admin-Verbindung gehen und Mitspieler/Zuschauer keinerlei Nachricht bekommen.
import { describe, expect, it } from 'vitest';
import { createSeededRng, type Card } from '@poker/engine';
import { PROTOCOL_VERSION, type ServerMessage } from '@poker/engine/protocol';
import type { CardRevealAudit, CardRevealAuditSink } from './admin-reveal';
import { ManualClock } from './clock';
import { GameServer, type GameClient, type GameServerOptions } from './game-server';
import { InMemoryTableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };
const ADMIN = 1;

type ErrorMessage = Extract<ServerMessage, { type: 'error' }>;

function setup(options: Partial<GameServerOptions> & { audit?: CardRevealAuditSink | null } = {}) {
  const clock = new ManualClock(1_000_000);
  const audits: CardRevealAudit[] = [];
  const { audit, ...rest } = options;
  const game = new GameServer({
    repository: new InMemoryTableRepository(),
    log: silentLog,
    clock,
    rng: createSeededRng(5),
    handPauseMs: 3000,
    ...(audit === null
      ? {}
      : {
          revealAudit:
            audit ??
            ((entry) => {
              audits.push(entry);
              return Promise.resolve(true);
            }),
        }),
    ...rest,
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
  const lastOf = (userId: number) => box(userId).at(-1);
  return { game, clock, audits, client, send, box, lastOf };
}

/** Admin (User 1) auf Sitz 0, Spieler 2 und 3 auf Sitz 3 und 6, Zuschauer 9; Runde gestartet. */
async function running(s: ReturnType<typeof setup>, { adminSeated = true } = {}) {
  const admin = await s.client(ADMIN, true);
  const b = await s.client(2);
  const c = await s.client(3);
  const spectator = await s.client(9);
  await s.send(b, { type: 'table.create', settings: { name: 'T', startingStack: 1000 } });
  const id = s.game.tableIds()[0] ?? 0;
  await s.send(b, { type: 'table.sit', tableId: id, seat: 3 });
  await s.send(admin, { type: 'table.join', tableId: id });
  if (adminSeated) await s.send(admin, { type: 'table.sit', tableId: id, seat: 0 });
  await s.send(c, { type: 'table.join', tableId: id });
  await s.send(c, { type: 'table.sit', tableId: id, seat: 6 });
  await s.send(spectator, { type: 'table.join', tableId: id });
  await s.send(b, { type: 'table.start', tableId: id });
  return { admin, b, c, spectator, id };
}

/** Echte Karten eines Users in der laufenden Hand (Serverzustand). */
function realCards(s: ReturnType<typeof setup>, tableId: number, userId: number): Card[] {
  const player = s.game.getTable(tableId)?.round?.hand?.players.find((p) => p.id === String(userId));
  if (player === undefined) throw new Error('Spieler nicht in der Hand');
  return [...player.holeCards];
}

describe('admin.revealCards', () => {
  it('welcome meldet das Admin-Flag der Session', async () => {
    const s = setup();
    await s.client(ADMIN, true);
    await s.client(2);
    expect(s.box(ADMIN)[0]).toMatchObject({ type: 'welcome', isAdmin: true });
    expect(s.box(2)[0]).toMatchObject({ type: 'welcome', isAdmin: false });
  });

  it('Admin bekommt die Karten nur selbst; Mitspieler und Zuschauer bekommen keine Nachricht', async () => {
    const s = setup();
    const { admin, id } = await running(s);
    const before = new Map([2, 3, 9].map((u) => [u, s.box(u).length]));
    const adminBefore = s.box(ADMIN).length;

    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 3, requestId: 'r1' });

    const handNumber = s.game.getTable(id)?.round?.handNumber;
    expect(s.box(ADMIN).slice(adminBefore)).toEqual([
      { type: 'admin.cards', requestId: 'r1', tableId: id, handNumber, seat: 3, cards: realCards(s, id, 2) },
    ]);
    for (const [u, n] of before) expect(s.box(u).length).toBe(n);
    expect(s.audits).toEqual([{ adminId: ADMIN, tableId: id, targetUserId: 2, roundId: 1, handNumber, seat: 3 }]);

    // Der normale Tischzustand des Admins enthält weiterhin keine fremden Karten.
    const state = [...s.box(ADMIN)].reverse().find((m) => m.type === 'table.state');
    const others = state?.type === 'table.state' ? state.table.round?.hand?.players : [];
    expect(others?.filter((p) => p.playerId !== String(ADMIN)).every((p) => p.holeCards === null)).toBe(true);
    // Und kein anderer Empfänger hat je eine admin.cards-Nachricht bekommen.
    for (const u of [2, 3, 9]) expect(s.box(u).some((m) => m.type === 'admin.cards')).toBe(false);
  });

  it('dieselben Karten in derselben Hand nur einmal protokolliert; neue Hand → neuer Eintrag', async () => {
    const s = setup();
    const { admin, id } = await running(s);
    const reveal = (seat: number) => s.send(admin, { type: 'admin.revealCards', tableId: id, seat });
    await reveal(3);
    await reveal(3);
    await reveal(3);
    expect(s.box(ADMIN).filter((m) => m.type === 'admin.cards')).toHaveLength(3);
    expect(s.audits).toHaveLength(1);
    await reveal(6);
    expect(s.audits.map((a) => a.targetUserId)).toEqual([2, 3]);

    // Hand beenden: alle außer einem folden.
    const table = s.game.getTable(id);
    for (let i = 0; i < 2; i++) {
      const toAct = table?.round?.hand?.toActId;
      if (toAct === null || toAct === undefined) break;
      table?.actFor(Number(toAct), { type: 'fold' });
    }
    expect(table?.round?.hand?.phase).toBe('complete');
    await reveal(3);
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'NO_HAND_IN_PROGRESS', tableId: id });

    s.clock.advance(3000); // nächste Hand
    expect(table?.round?.hand?.phase).toBe('betting');
    await reveal(3);
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'admin.cards', seat: 3, handNumber: 2, cards: realCards(s, id, 2) });
    expect(s.audits).toHaveLength(3);
    expect(s.audits[2]).toMatchObject({ handNumber: 2, targetUserId: 2 });
  });

  it('Nicht-Admin → FORBIDDEN, nichts protokolliert, keine Karten', async () => {
    const s = setup();
    const { b, id } = await running(s);
    await s.send(b, { type: 'admin.revealCards', tableId: id, seat: 6, requestId: 'x', isAdmin: true });
    expect(s.lastOf(2)).toEqual({
      type: 'error',
      code: 'FORBIDDEN',
      message: expect.any(String) as string,
      requestId: 'x',
      tableId: id,
    } satisfies ErrorMessage);
    expect(s.audits).toEqual([]);
    for (const u of [ADMIN, 2, 3, 9]) expect(s.box(u).some((m) => m.type === 'admin.cards')).toBe(false);
  });

  it('Admin muss am Tisch sitzen; Zuschauer → NOT_SEATED, ohne Beitritt → NOT_AT_TABLE', async () => {
    const s = setup();
    const { admin, id } = await running(s, { adminSeated: false });
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 3 });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'NOT_SEATED' });
    await s.send(admin, { type: 'table.leave', tableId: id });
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 3 });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'NOT_AT_TABLE' });
    expect(s.audits).toEqual([]);
  });

  it('vor dem Start NO_HAND_IN_PROGRESS; eigener, leerer und gefoldeter Platz → INVALID_SEAT', async () => {
    const s = setup();
    const admin = await s.client(ADMIN, true);
    const b = await s.client(2);
    const c = await s.client(3);
    await s.send(admin, { type: 'table.create', settings: { name: 'T', startingStack: 1000 } });
    const id = s.game.tableIds()[0] ?? 0;
    await s.send(admin, { type: 'table.sit', tableId: id, seat: 0 });
    for (const [cl, seat] of [
      [b, 1],
      [c, 2],
    ] as const) {
      await s.send(cl, { type: 'table.join', tableId: id });
      await s.send(cl, { type: 'table.sit', tableId: id, seat });
    }
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 1 });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'NO_HAND_IN_PROGRESS' });

    await s.send(admin, { type: 'table.start', tableId: id });
    for (const seat of [0, 5]) {
      await s.send(admin, { type: 'admin.revealCards', tableId: id, seat });
      expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'INVALID_SEAT' });
    }
    // Wer zuerst handelt, foldet (nicht der Admin, sonst wäre er selbst raus).
    const table = s.game.getTable(id);
    const toAct = Number(table?.round?.hand?.toActId);
    if (toAct === ADMIN) table?.actFor(ADMIN, { type: 'call' });
    const folder = Number(table?.round?.hand?.toActId);
    expect(folder).not.toBe(ADMIN);
    table?.actFor(folder, { type: 'fold' });
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: table?.seatOf(folder) });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'INVALID_SEAT' });
    expect(s.audits).toEqual([]);
  });

  it('Protokoll verneint das Admin-Recht (z. B. inzwischen entzogen) → FORBIDDEN, keine Karten', async () => {
    const s = setup({ audit: () => Promise.resolve(false) });
    const { admin, id } = await running(s);
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 3 });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
    expect(s.box(ADMIN).some((m) => m.type === 'admin.cards')).toBe(false);
  });

  it('Protokoll schlägt fehl → INTERNAL, keine Karten; ohne Protokoll-Senke abgeschaltet', async () => {
    const failing = setup({ audit: () => Promise.reject(new Error('DB weg')) });
    const r1 = await running(failing);
    await failing.send(r1.admin, { type: 'admin.revealCards', tableId: r1.id, seat: 3 });
    expect(failing.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'INTERNAL' });
    expect(failing.box(ADMIN).some((m) => m.type === 'admin.cards')).toBe(false);

    const off = setup({ audit: null });
    const r2 = await running(off);
    await off.send(r2.admin, { type: 'admin.revealCards', tableId: r2.id, seat: 3 });
    expect(off.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'FORBIDDEN' });
  });

  it('Hand endet während des Protokollierens → keine Karten der vergangenen Hand', async () => {
    let finishHand: () => void = () => undefined;
    const s = setup({
      audit: () => {
        finishHand();
        return Promise.resolve(true);
      },
    });
    const { admin, id } = await running(s);
    const table = s.game.getTable(id);
    finishHand = () => {
      for (let i = 0; i < 2; i++) {
        const toAct = table?.round?.hand?.toActId;
        if (toAct !== null && toAct !== undefined) table?.actFor(Number(toAct), { type: 'fold' });
      }
    };
    await s.send(admin, { type: 'admin.revealCards', tableId: id, seat: 3 });
    expect(s.lastOf(ADMIN)).toMatchObject({ type: 'error', code: 'NO_HAND_IN_PROGRESS' });
    expect(s.box(ADMIN).some((m) => m.type === 'admin.cards')).toBe(false);
  });
});
