// Avatare am Tisch und Emoji-Reaktionen (WP-032) ohne Netzwerk und DB: GameServer mit In-Memory-Verbindungen.
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@poker/engine';
import {
  PROTOCOL_VERSION,
  REACTION_COOLDOWN_MS,
  type AvatarId,
  type ServerMessage,
  type TableView,
} from '@poker/engine/protocol';
import { ManualClock } from './clock';
import { GameServer, type GameClient } from './game-server';
import { InMemoryTableRepository } from './repository';

const silentLog = { error: () => undefined, warn: () => undefined };

function setup() {
  const clock = new ManualClock(1_000_000);
  const game = new GameServer({
    repository: new InMemoryTableRepository(),
    log: silentLog,
    clock,
    rng: createSeededRng(7),
    handPauseMs: 0,
  });
  const inbox = new Map<number, ServerMessage[]>();
  async function client(userId: number, avatar: AvatarId | null = null): Promise<GameClient> {
    const box: ServerMessage[] = [];
    inbox.set(userId, box);
    const c = game.connect(
      { id: userId, username: `u${String(userId)}`, avatar },
      { send: (m) => box.push(m), close: () => undefined },
    );
    await game.handle(c, JSON.stringify({ type: 'hello', protocolVersion: PROTOCOL_VERSION }));
    return c;
  }
  const send = (c: GameClient, msg: object) => game.handle(c, JSON.stringify(msg));
  const messages = (userId: number) => inbox.get(userId) ?? [];
  const last = (userId: number): TableView => {
    const box = messages(userId);
    for (let i = box.length - 1; i >= 0; i--) {
      const m = box[i] as ServerMessage;
      if (m.type === 'table.state') return m.table;
    }
    throw new Error('kein Zustand');
  };
  const reactions = (userId: number) => messages(userId).filter((m) => m.type === 'table.reaction');
  const errors = (userId: number) =>
    messages(userId).flatMap((m) => (m.type === 'error' ? [{ code: m.code, tableId: m.tableId }] : []));
  return { game, clock, client, send, last, reactions, errors };
}

/** Tisch mit zwei Spielern (1: Fuchs, 2: ohne Avatar) und einem Zuschauer (3). */
async function table(s: ReturnType<typeof setup>) {
  const a = await s.client(1, 'fox');
  const b = await s.client(2);
  const spectator = await s.client(3, 'owl');
  await s.send(a, { type: 'table.create', settings: { name: 'T' } });
  const id = s.last(1).id;
  await s.send(a, { type: 'table.sit', tableId: id, seat: 0 });
  await s.send(b, { type: 'table.join', tableId: id });
  await s.send(b, { type: 'table.sit', tableId: id, seat: 4 });
  await s.send(spectator, { type: 'table.join', tableId: id });
  return { a, b, spectator, id };
}

describe('Avatare am Tisch (WP-032)', () => {
  it('jeder Sitz zeigt den Avatar seines Spielers, ohne Avatar null', async () => {
    const s = setup();
    await table(s);
    expect(s.last(3).seats.map((seat) => [seat.seat, seat.avatar])).toEqual([
      [0, 'fox'],
      [4, null],
    ]);
  });

  it('eine Änderung des Avatars erreicht sofort alle Beobachter, auch während der Runde', async () => {
    const s = setup();
    const { a, id } = await table(s);
    await s.send(a, { type: 'table.start', tableId: id });
    s.game.setAvatar(2, 'robot');
    expect(s.last(1).seats.find((seat) => seat.seat === 4)?.avatar).toBe('robot');
    expect(s.last(3).seats.find((seat) => seat.seat === 4)?.avatar).toBe('robot');
    s.game.setAvatar(1, null);
    expect(s.last(2).seats.find((seat) => seat.seat === 0)?.avatar).toBeNull();
  });

  it('gilt auch für das nächste Hinsetzen derselben Verbindung', async () => {
    const s = setup();
    const { b, id } = await table(s);
    await s.send(b, { type: 'table.stand', tableId: id });
    s.game.setAvatar(2, 'cactus');
    await s.send(b, { type: 'table.sit', tableId: id, seat: 5 });
    expect(s.last(1).seats.find((seat) => seat.seat === 5)?.avatar).toBe('cactus');
  });

  it('ändert nichts an Tischen, an denen der User nicht sitzt', async () => {
    const s = setup();
    await table(s);
    const before = s.last(1);
    s.game.setAvatar(3, 'moon'); // Zuschauer
    expect(s.last(1)).toBe(before);
  });
});

describe('Emoji-Reaktionen (WP-032)', () => {
  it('erscheint bei allen Beobachtern, auch beim Zuschauer und beim Absender', async () => {
    const s = setup();
    const { b, id } = await table(s);
    await s.send(b, { type: 'table.react', tableId: id, reaction: 'laugh' });
    const expected = { type: 'table.reaction', tableId: id, seat: 4, userId: 2, reaction: 'laugh' };
    for (const user of [1, 2, 3]) expect(s.reactions(user)).toEqual([expected]);
  });

  it('höchstens eine pro 2 s und User; abgelehnte Versuche verlängern die Sperre nicht', async () => {
    const s = setup();
    const { a, id } = await table(s);
    await s.send(a, { type: 'table.react', tableId: id, reaction: 'fire' });
    s.clock.advance(REACTION_COOLDOWN_MS - 1);
    await s.send(a, { type: 'table.react', tableId: id, reaction: 'fire' });
    expect(s.errors(1)).toEqual([{ code: 'RATE_LIMITED', tableId: id }]);
    expect(s.reactions(2)).toHaveLength(1);
    s.clock.advance(1);
    await s.send(a, { type: 'table.react', tableId: id, reaction: 'clap' });
    expect(s.reactions(2)).toHaveLength(2);
    expect(s.errors(1)).toHaveLength(1);
  });

  it('das Limit gilt pro User, nicht pro Tisch', async () => {
    const s = setup();
    const { a, b, id } = await table(s);
    await s.send(a, { type: 'table.react', tableId: id, reaction: 'wow' });
    await s.send(b, { type: 'table.react', tableId: id, reaction: 'wow' });
    expect(s.reactions(3)).toHaveLength(2);
    await s.send(a, { type: 'table.create', settings: { name: 'Zweiter' } });
    const other = s.last(1).id;
    await s.send(a, { type: 'table.sit', tableId: other, seat: 0 });
    await s.send(a, { type: 'table.react', tableId: other, reaction: 'wow' });
    expect(s.errors(1)).toEqual([{ code: 'RATE_LIMITED', tableId: other }]);
  });

  it('Zuschauer und Fremde dürfen nicht reagieren', async () => {
    const s = setup();
    const { spectator, id } = await table(s);
    await s.send(spectator, { type: 'table.react', tableId: id, reaction: 'cry' });
    expect(s.errors(3)).toEqual([{ code: 'NOT_SEATED', tableId: id }]);
    const stranger = await s.client(4);
    await s.send(stranger, { type: 'table.react', tableId: id, reaction: 'cry' });
    expect(s.errors(4)).toEqual([{ code: 'NOT_AT_TABLE', tableId: id }]);
    expect(s.reactions(1)).toEqual([]);
  });

  it('unbekannte Reaktionen lehnt die Validierung ab', async () => {
    const s = setup();
    const { a, id } = await table(s);
    await s.send(a, { type: 'table.react', tableId: id, reaction: 'poop' });
    expect(s.errors(1)).toEqual([{ code: 'BAD_MESSAGE', tableId: null }]);
  });
});
