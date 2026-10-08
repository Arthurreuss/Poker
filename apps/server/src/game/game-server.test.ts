// Tischmodell ohne Netzwerk und ohne DB (WP-011): GameServer mit In-Memory-Verbindungen, ManualClock.
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import { PROTOCOL_VERSION, type ServerMessage, type TableView } from '@poker/engine/protocol';
import { ManualClock } from './clock';
import { GameServer, type GameClient, type GameServerOptions } from './game-server';
import { InMemoryTableRepository, type TableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };

function setup(options: Partial<GameServerOptions> = {}) {
  const clock = new ManualClock(1_000_000);
  const repository = options.repository ?? new InMemoryTableRepository();
  const game = new GameServer({
    repository,
    log: silentLog,
    clock,
    rng: createSeededRng(3),
    handPauseMs: 3000,
    ...options,
  });
  const inbox = new Map<number, ServerMessage[]>();
  const clients = new Map<number, GameClient>();
  async function client(userId: number): Promise<GameClient> {
    const box: ServerMessage[] = [];
    inbox.set(userId, box);
    const c = game.connect(
      { id: userId, username: `u${String(userId)}` },
      { send: (m) => box.push(m), close: () => undefined },
    );
    clients.set(userId, c);
    await game.handle(c, JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION }));
    return c;
  }
  const send = (c: GameClient, msg: object) => game.handle(c, JSON.stringify(msg));
  const last = (userId: number): TableView => {
    const box = inbox.get(userId) ?? [];
    for (let i = box.length - 1; i >= 0; i--) {
      const m = box[i] as ServerMessage;
      if (m.type === 'table.state') return m.table;
    }
    throw new Error('kein Zustand');
  };
  const errors = (userId: number) => (inbox.get(userId) ?? []).filter((m) => m.type === 'error');
  return { game, clock, repository, client, send, last, errors };
}

async function twoSeated(s: ReturnType<typeof setup>) {
  const a = await s.client(1);
  const b = await s.client(2);
  await s.send(a, { type: 'table.create', settings: { name: 'T', startingStack: 1000 } });
  const id = s.last(1).id;
  await s.send(a, { type: 'table.sit', tableId: id, seat: 0 });
  await s.send(b, { type: 'table.join', tableId: id });
  await s.send(b, { type: 'table.sit', tableId: id, seat: 1 });
  return { a, b, id };
}

describe('GameServer ohne Netzwerk', () => {
  it('wartet nach jeder Hand die konfigurierte Pause, bevor die nächste startet', async () => {
    const s = setup();
    const { a, b, id } = await twoSeated(s);
    await s.send(a, { type: 'table.start', tableId: id });
    const hand = s.last(1).round?.hand;
    expect(hand?.handNumber).toBe(1);
    // Heads-up: wer am Zug ist, foldet → Hand 1 vorbei.
    const actor = hand?.toActId === '1' ? a : b;
    await s.send(actor, {
      type: 'table.action',
      tableId: id,
      handNumber: 1,
      seq: hand?.actionSeq,
      action: { type: 'fold' },
    });
    expect(s.last(1).round?.hand?.phase).toBe('complete');
    expect(s.clock.pendingCount).toBe(1);

    s.clock.advance(2999);
    expect(s.last(1).round?.handNumber).toBe(1);
    s.clock.advance(1);
    expect(s.last(1).round?.handNumber).toBe(2);
    expect(s.last(2).round?.hand?.phase).toBe('betting');
  });

  it('Blind-Level und „nächstes Level“ folgen der injizierten Uhr', async () => {
    const s = setup({ handPauseMs: 0 });
    const { a, id } = await twoSeated(s);
    await s.send(a, { type: 'table.start', tableId: id });
    const level = s.last(1).round?.blindLevel;
    expect(level).toEqual({ smallBlind: 10, bigBlind: 20, levelIndex: 0, nextLevelAtMs: 1_000_000 + 600_000 });
  });

  it('WP-012-Erweiterungspunkte: actFor/autoCheckOrFold handeln im Namen eines Spielers', async () => {
    const s = setup();
    const { a, id } = await twoSeated(s);
    await s.send(a, { type: 'table.start', tableId: id });
    const table = s.game.getTable(id);
    const toAct = Number(s.last(1).round?.hand?.toActId);
    expect(table?.isConnected(toAct)).toBe(true);
    // Preflop muss der Small Blind callen → Check geht nicht → Fold.
    expect(table?.autoCheckOrFold(toAct)).toEqual({ ok: true });
    expect(s.last(1).round?.hand?.phase).toBe('complete');
    expect(table?.actFor(toAct, { type: 'check' })).toMatchObject({ ok: false, code: 'NO_HAND_IN_PROGRESS' });
  });

  it('DB-Fehler beim Start: Fehler an den Absender, Tisch bleibt offen und bedienbar', async () => {
    const memory = new InMemoryTableRepository();
    const failing: TableRepository = {
      createTable: (t) => memory.createTable(t),
      startRound: () => Promise.reject(new Error('DB weg')),
      finishRound: (...args) => memory.finishRound(...args),
      closeTable: (id) => memory.closeTable(id),
    };
    const s = setup({ repository: failing });
    const { a, b, id } = await twoSeated(s);
    await s.send(a, { type: 'table.start', tableId: id, requestId: 'go' });
    expect(s.errors(1)).toEqual([
      { type: 'error', code: 'INTERNAL', message: expect.any(String) as string, requestId: 'go', tableId: id },
    ]);
    expect(s.last(1).status).toBe('open');
    await s.send(b, { type: 'table.stand', tableId: id });
    expect(s.last(1).seats).toHaveLength(1);
    expect(s.errors(2)).toEqual([]);
  });

  it('beendet nach dem Schließen keine Spielschritte mehr', async () => {
    const s = setup();
    const { a, b, id } = await twoSeated(s);
    await s.send(a, { type: 'table.start', tableId: id });
    const hand = s.last(1).round?.hand;
    await s.send(hand?.toActId === '1' ? a : b, {
      type: 'table.action',
      tableId: id,
      handNumber: 1,
      seq: hand?.actionSeq,
      action: { type: 'fold' },
    });
    s.game.close();
    s.clock.advance(10_000);
    expect(s.last(1).round?.handNumber).toBe(1);
  });
});
