// Integration Hand-Historie + Postgres (WP-013): ganze Runden über den Game-Server (ohne Netzwerk, ManualClock),
// danach alles aus der DB laden, mit dem Serverzustand vergleichen und per Engine nachspielen. Außerdem:
// Speicherfehler und Server-Neustart mitten in der Runde. Nur mit TEST_DATABASE_URL: `npm run test:db -w @poker/server`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSeededRng, legalActions, placementPoints, type Action, type HandState, type Rng } from '@poker/engine';
import { PROTOCOL_VERSION, type TableSettingsInput } from '@poker/engine/protocol';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import type { HandRow, RoundPlayerRow, RoundRow, TableRow } from '../db/types';
import { ManualClock } from '../game/clock';
import { DEFAULT_ORPHAN_TIMEOUT_MS, GameServer, type GameClient } from '../game/game-server';
import type { GameHooks, RoundCompleteEvent } from '../game/hooks';
import { closeOrphanedTables, createPgTableRepository } from '../game/pg-repository';
import { combineHooks, createHandHistoryHooks } from './hooks';
import { toHandRecord } from './records';
import { replayHandRecord } from './replay';
import { withFinishRoundRetry } from './retry';
import {
  createPgHandHistoryStore,
  loadRoundHands,
  loadUserPoints,
  type HandHistoryStore,
  type LoadedHand,
} from './store';

const HAND_PAUSE_MS = 1000;

interface Captured {
  /** Abgeschlossene Hände aus `onHandComplete` je Runde und Handnummer. */
  hands: Map<string, HandState>;
  rounds: RoundCompleteEvent[];
}

describe.skipIf(testDatabaseUrl === undefined)('Hand-Historie mit Postgres', () => {
  let s: TestSchema;

  beforeAll(async () => {
    s = await createTestSchema(testDatabaseUrl ?? '');
    await runMigrations(s.config);
  });

  afterAll(async () => {
    await s.drop();
  });

  beforeEach(async () => {
    await s.pool.query(
      'TRUNCATE users, sessions, tables, rounds, round_players, hands, hand_actions RESTART IDENTITY CASCADE',
    );
  });

  async function users(...names: string[]): Promise<number[]> {
    const { rows } = await s.pool.query<{ id: number }>(
      `INSERT INTO users (username, password_hash) SELECT n, 'x' FROM unnest($1::text[]) AS n RETURNING id`,
      [names],
    );
    return rows.map((r) => r.id);
  }

  function setup(options: { store?: HandHistoryStore; seed?: number } = {}) {
    const clock = new ManualClock(1_000_000);
    const errors: object[] = [];
    const log = { error: (obj: object) => errors.push(obj), warn: () => undefined };
    const retry = { delaysMs: [0, 0], log };
    const captured: Captured = { hands: new Map(), rounds: [] };
    const capture: GameHooks = {
      onHandComplete: (e) => {
        captured.hands.set(`${String(e.roundId)}/${String(e.handNumber)}`, e.hand);
      },
      onRoundComplete: (e) => {
        captured.rounds.push(e);
      },
    };
    const game = new GameServer({
      repository: withFinishRoundRetry(createPgTableRepository(s.pool), retry),
      hooks: combineHooks(createHandHistoryHooks(options.store ?? createPgHandHistoryStore(s.pool), retry), capture),
      log,
      clock,
      rng: createSeededRng(options.seed ?? 1),
      handPauseMs: HAND_PAUSE_MS,
    });
    const clients = new Map<number, GameClient>();
    const send = (userId: number, msg: object) => {
      const c = clients.get(userId);
      if (c === undefined) throw new Error(`Client ${String(userId)} fehlt`);
      return game.handle(c, JSON.stringify(msg));
    };

    /** Tisch anlegen, alle setzen sich, Ersteller startet. Liefert die Tisch-ID. */
    async function startTable(ids: number[], settings: Partial<TableSettingsInput> = {}): Promise<number> {
      let tableId = 0;
      for (const id of ids) {
        const c = game.connect(
          { id, username: `u${String(id)}` },
          {
            send: (m) => {
              if (m.type === 'table.created') tableId = m.tableId;
            },
            close: () => undefined,
          },
        );
        clients.set(id, c);
        await send(id, { type: 'hello', protocolVersion: PROTOCOL_VERSION });
      }
      const [creator] = ids as [number];
      await send(creator, {
        type: 'table.create',
        settings: {
          name: 'Historie',
          startingStack: 400,
          blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
          ...settings,
        },
      });
      for (const [seat, id] of ids.entries()) {
        if (id !== creator) await send(id, { type: 'table.join', tableId });
        await send(id, { type: 'table.sit', tableId, seat: seat * 2 });
      }
      await send(creator, { type: 'table.start', tableId });
      return tableId;
    }

    /** Zufallsbot für den Spieler am Zug; zwischen den Händen Uhr vorstellen. Spielt bis zum Rundenende. */
    function playToEnd(tableId: number, rng: Rng): void {
      const table = game.getTable(tableId);
      if (table === undefined) throw new Error('Tisch fehlt');
      for (let steps = 0; table.status === 'running'; steps++) {
        if (steps > 20_000) throw new Error('Runde endet nicht');
        const hand = table.round?.phase === 'hand' ? table.round.hand : null;
        if (hand === null) {
          clock.advance(HAND_PAUSE_MS);
          continue;
        }
        const legal = legalActions(hand);
        if (legal === null) throw new Error('niemand am Zug');
        const result = table.actFor(Number(legal.playerId), botAction(rng, legal.actions));
        if (!result.ok) throw new Error(result.message);
      }
    }

    /** Alle Verbindungen trennen (Spieler weg, WP-015/D-022). */
    function disconnectAll(): void {
      for (const c of clients.values()) game.disconnect(c);
    }

    return { game, clock, errors, captured, startTable, playToEnd, send, disconnectAll };
  }

  function botAction(rng: Rng, actions: NonNullable<ReturnType<typeof legalActions>>['actions']): Action {
    const roll = rng.int(20);
    const find = (t: string) => actions.find((a) => a.type === t);
    // Große Einsätze meist folden, damit Runden mehrere Hände dauern.
    const call = find('call');
    if (call?.type === 'call' && call.amount > 60 && roll < 12) return { type: 'fold' };
    const a =
      (roll < 1 ? find('allIn') : roll < 4 ? find('fold') : roll < 8 ? (find('bet') ?? find('raise')) : undefined) ??
      find('check') ??
      find('call') ??
      actions[0];
    if (a === undefined) throw new Error('keine Aktion');
    if (a.type === 'bet' || a.type === 'raise') return { type: a.type, amount: a.min };
    return { type: a.type };
  }

  async function roundOf(tableId: number): Promise<RoundRow> {
    const { rows } = await s.pool.query<RoundRow>('SELECT * FROM rounds WHERE table_id = $1', [tableId]);
    expect(rows).toHaveLength(1);
    return rows[0] as RoundRow;
  }

  /** Gespeicherte Hand ohne DB-Metadaten (id, startedAt, finishedAt) = `HandRecord`. */
  const META = new Set(['id', 'startedAt', 'finishedAt']);
  const stripMeta = (h: LoadedHand) => Object.fromEntries(Object.entries(h).filter(([k]) => !META.has(k)));

  it('nach einer Runde sind alle Hände mit Aktionen und Ergebnissen gespeichert; jede Hand ergibt im Replay dasselbe', async () => {
    const ids = await users('anna', 'ben', 'cleo', 'dora');
    const t = setup({ seed: 7 });
    const tableId = await t.startTable(ids);
    t.playToEnd(tableId, createSeededRng(99));
    await t.game.idle();
    expect(t.errors).toEqual([]);

    const round = await roundOf(tableId);
    expect(round.status).toBe('finished');
    const hands = await loadRoundHands(s.pool, round.id);
    const finalRound = t.captured.rounds[0]?.round;
    expect(hands.map((h) => h.handNumber)).toEqual(
      Array.from({ length: finalRound?.handNumber ?? 0 }, (_, i) => i + 1),
    );
    expect(hands.length).toBeGreaterThan(3);

    let actionCount = 0;
    for (const stored of hands) {
      const served = t.captured.hands.get(`${String(round.id)}/${String(stored.handNumber)}`);
      if (served === undefined) throw new Error(`Hand ${String(stored.handNumber)} nicht beobachtet`);
      // Gespeichert = Serverzustand der Hand.
      expect(stripMeta(stored)).toEqual(toHandRecord(round.id, stored.handNumber, served));
      expect(stored.finishedAt).toBeInstanceOf(Date);
      expect(stored.result).not.toBeNull();
      // Replay mit demselben Deck → derselbe Datensatz, dieselben Auszahlungen und Showdown-Ergebnisse.
      const replayed = replayHandRecord(stored);
      if (!replayed.ok) throw new Error(`Hand ${String(stored.handNumber)}: ${replayed.message}`);
      expect(replayed.record).toEqual(stripMeta(stored));
      expect(replayed.state.payouts).toEqual(served.payouts);
      expect(replayed.state.showdown).toEqual(served.showdown);
      expect(replayed.state.players.map((p) => p.stack)).toEqual(served.players.map((p) => p.stack));
      actionCount += served.log.length;
    }
    const { rows: count } = await s.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM hand_actions a JOIN hands h ON h.id = a.hand_id WHERE h.round_id = $1',
      [round.id],
    );
    expect(count[0]?.n).toBe(actionCount);
    // Spalten aus 0003 direkt in der Tabelle.
    const { rows: raw } = await s.pool.query<HandRow>('SELECT * FROM hands WHERE round_id = $1 ORDER BY hand_number', [
      round.id,
    ]);
    expect(raw.every((h) => h.deck?.length === 52 && h.big_blind_seat !== null)).toBe(true);
  }, 30_000);

  it('Rundenende: Platzierungen und Punkte (D-012, geteilte Plätze D-018) in round_players, Summe auf dem Account', async () => {
    const ids = await users('pia', 'pit', 'pam', 'pez', 'pol');
    const expected = new Map<number, number>(ids.map((id) => [id, 0]));
    const t = setup({ seed: 3 });
    for (const seed of [1, 2, 3]) {
      const tableId = await t.startTable(ids);
      t.playToEnd(tableId, createSeededRng(seed));
      await t.game.idle();
      const round = await roundOf(tableId);
      const event = t.captured.rounds.at(-1);
      if (event === undefined) throw new Error('kein Rundenende');
      const { rows } = await s.pool.query<RoundPlayerRow>(
        'SELECT * FROM round_players WHERE round_id = $1 ORDER BY placement, seat',
        [round.id],
      );
      expect(rows.map((r) => [r.user_id, r.placement, r.points])).toEqual(
        event.standings.map((st) => [st.userId, st.placement, st.points]),
      );
      // Punkte unabhängig nachgerechnet: Platz k von n → n − k (+1 für den Sieger), geteilte Plätze gemittelt.
      const tied = new Map<number, number>();
      for (const r of rows) tied.set(r.placement ?? 0, (tied.get(r.placement ?? 0) ?? 0) + 1);
      for (const r of rows) {
        const place = r.placement ?? 0;
        const k = tied.get(place) ?? 1;
        let sum = 0;
        for (let p = place; p < place + k; p++) sum += rows.length - p + (p === 1 ? 1 : 0);
        expect(r.points).toBe(Math.floor(sum / k));
        expect(r.points).toBe(placementPoints(place, rows.length, k));
        expected.set(r.user_id, (expected.get(r.user_id) ?? 0) + (r.points ?? 0));
      }
      expect(rows.filter((r) => r.placement === 1)).toHaveLength(1);
    }
    expect(await loadUserPoints(s.pool, ids)).toEqual(
      ids.map((id) => ({ userId: id, points: expected.get(id), rounds: 3 })),
    );
  }, 30_000);

  it('Speicherfehler halten das Spiel nicht an: vorübergehende werden wiederholt, dauerhafte nur geloggt', async () => {
    const ids = await users('fay', 'fin', 'fox');
    const pg = createPgHandHistoryStore(s.pool);
    let flaky = 0;
    const transient = Object.assign(new Error('Connection terminated unexpectedly'), {});
    const flakyStore: HandHistoryStore = {
      saveHandStarted: (r) => (flaky++ % 2 === 0 ? Promise.reject(transient) : pg.saveHandStarted(r)),
      saveHandCompleted: (r) => (flaky++ % 2 === 0 ? Promise.reject(transient) : pg.saveHandCompleted(r)),
    };
    const t1 = setup({ store: flakyStore, seed: 4 });
    const table1 = await t1.startTable(ids);
    t1.playToEnd(table1, createSeededRng(4));
    await t1.game.idle();
    expect(t1.errors).toEqual([]);
    const round1 = await roundOf(table1);
    const hands1 = await loadRoundHands(s.pool, round1.id);
    expect(hands1).toHaveLength(t1.captured.rounds[0]?.round.handNumber ?? -1);
    expect(hands1.every((h) => h.result !== null)).toBe(true);

    const broken: HandHistoryStore = {
      saveHandStarted: () => Promise.reject(new Error('DB weg')),
      saveHandCompleted: () => Promise.reject(new Error('DB weg')),
    };
    const t2 = setup({ store: broken, seed: 5 });
    const table2 = await t2.startTable(ids);
    t2.playToEnd(table2, createSeededRng(5));
    await t2.game.idle();
    // Runde trotzdem zu Ende gespielt und gewertet; jede Hand zweimal (Start, Ende) als Fehler geloggt.
    const round2 = await roundOf(table2);
    expect(round2.status).toBe('finished');
    const handCount = t2.captured.rounds[0]?.round.handNumber ?? 0;
    expect(t2.errors).toHaveLength(2 * handCount);
    expect(await loadRoundHands(s.pool, round2.id)).toEqual([]);
  }, 30_000);

  it('automatische Aktionen (Zeitablauf, D-013) werden wie normale gespeichert und als automatisch markiert', async () => {
    const ids = await users('ava', 'abe', 'amy');
    const t = setup({ seed: 9 });
    const tableId = await t.startTable(ids, { turnTimeSeconds: 10, timeBankSeconds: 0 });
    const table = t.game.getTable(tableId);
    if (table === undefined) throw new Error('Tisch fehlt');
    // Erste Aktion selbst (Call), danach läuft für alle nur noch die Zeit ab → Check, sonst Fold.
    expect(table.actFor(Number(table.round?.hand?.toActId), { type: 'call' }).ok).toBe(true);
    for (let i = 0; i < 50 && table.round?.handNumber === 1 && table.round.hand?.phase === 'betting'; i++) {
      t.clock.advance(10_000);
    }
    expect(table.round?.hand?.phase).toBe('complete');
    await t.game.idle();
    expect(t.errors).toEqual([]);

    const [hand] = await loadRoundHands(s.pool, (await roundOf(tableId)).id);
    if (hand === undefined) throw new Error('Hand fehlt');
    const actions = hand.actions.map((a) => [a.action, a.isAutomatic]);
    expect(actions.slice(0, 3)).toEqual([
      ['small_blind', false],
      ['big_blind', false],
      ['call', false],
    ]);
    expect(actions.length).toBeGreaterThan(3);
    expect(actions.slice(3).every(([action, auto]) => auto === true && (action === 'check' || action === 'fold'))).toBe(
      true,
    );
    const { rows } = await s.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM hand_actions WHERE hand_id = $1 AND is_automatic',
      [hand.id],
    );
    expect(rows[0]?.n).toBe(actions.length - 3);
    // Replay ergibt denselben Datensatz inkl. Markierung.
    const replayed = replayHandRecord(hand);
    if (!replayed.ok) throw new Error(replayed.message);
    expect(replayed.record).toEqual(stripMeta(hand));
  });

  it('Neustart mitten in der Runde: Runde → aborted ohne Punkte, gespeicherte Hände bleiben (letzte ohne Ergebnis)', async () => {
    const ids = await users('ray', 'rob', 'ria');
    const t = setup({ seed: 8 });
    const tableId = await t.startTable(ids);
    const table = t.game.getTable(tableId);
    if (table === undefined) throw new Error('Tisch fehlt');
    // Hand 1: alle folden bis auf den Big Blind; Hand 2 beginnt und bleibt offen (einer hat schon gecallt).
    for (let i = 0; i < 2; i++) {
      const toAct = table.round?.hand?.toActId;
      if (toAct === null || toAct === undefined) throw new Error('niemand am Zug');
      expect(table.actFor(Number(toAct), { type: 'fold' }).ok).toBe(true);
    }
    expect(table.round?.hand?.phase).toBe('complete');
    t.clock.advance(HAND_PAUSE_MS);
    expect(table.round?.handNumber).toBe(2);
    expect(table.actFor(Number(table.round?.hand?.toActId), { type: 'call' }).ok).toBe(true);
    await t.game.idle();
    const roundId = (await roundOf(tableId)).id;

    // „Absturz“: Prozess weg, Tisch nur im Speicher. Beim Start ruft main.ts closeOrphanedTables auf.
    t.game.close();
    expect(await closeOrphanedTables(s.pool)).toEqual({ rounds: 1, tables: 1 });

    const round = await roundOf(tableId);
    expect(round.status).toBe('aborted');
    expect(round.finished_at).toBeInstanceOf(Date);
    const { rows: tables } = await s.pool.query<TableRow>('SELECT status FROM tables WHERE id = $1', [tableId]);
    expect(tables[0]?.status).toBe('closed');
    const { rows: players } = await s.pool.query<RoundPlayerRow>('SELECT * FROM round_players WHERE round_id = $1', [
      roundId,
    ]);
    expect(players.map((p) => [p.placement, p.points])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(await loadUserPoints(s.pool, ids)).toEqual(ids.map((userId) => ({ userId, points: 0, rounds: 0 })));

    const hands = await loadRoundHands(s.pool, roundId);
    expect(hands.map((h) => [h.handNumber, h.result === null, h.finishedAt === null])).toEqual([
      [1, false, false],
      [2, true, true],
    ]);
    // Abgeschlossene Hand der abgebrochenen Runde bleibt nachspielbar.
    const replayed = replayHandRecord(hands[0] as LoadedHand);
    expect(replayed.ok).toBe(true);
    // Unvollständige Hand: Ausgangslage vollständig (Deck, Hole Cards), aber keine Aktionen, kein Board.
    const open = hands[1] as LoadedHand;
    expect(open.deck).toHaveLength(52);
    expect(open.players.every((p) => p.holeCards.length === 2)).toBe(true);
    expect(open.actions).toEqual([]);
    expect(open.board).toEqual([]);
  });

  it('verwaiste Runde (D-022): 10 Minuten kein Spieler verbunden → Runde aborted ohne Punkte, Tisch closed', async () => {
    const ids = await users('wp015_ola', 'wp015_ole');
    const t = setup({ seed: 4 });
    const tableId = await t.startTable(ids, { startingStack: 100_000 });
    const roundId = (await roundOf(tableId)).id;
    t.disconnectAll();
    t.clock.advance(DEFAULT_ORPHAN_TIMEOUT_MS);
    expect(t.game.getTable(tableId)).toBeUndefined();
    await t.game.idle();
    expect(t.errors).toEqual([]);

    const round = await roundOf(tableId);
    expect(round.status).toBe('aborted');
    expect(round.finished_at).toBeInstanceOf(Date);
    const { rows: tables } = await s.pool.query<TableRow>('SELECT status, closed_at FROM tables WHERE id = $1', [
      tableId,
    ]);
    expect(tables[0]?.status).toBe('closed');
    expect(tables[0]?.closed_at).toBeInstanceOf(Date);
    const { rows: players } = await s.pool.query<RoundPlayerRow>('SELECT * FROM round_players WHERE round_id = $1', [
      roundId,
    ]);
    expect(players.every((p) => p.placement === null && p.points === null)).toBe(true);
    expect(await loadUserPoints(s.pool, ids)).toEqual(ids.map((userId) => ({ userId, points: 0, rounds: 0 })));
    // Die Runde lief bis zum Abbruch allein weiter (Auto-Check/Fold); gespeicherte Hände bleiben.
    const hands = await loadRoundHands(s.pool, roundId);
    expect(hands.length).toBeGreaterThan(1);
    expect(hands.slice(0, -1).every((h) => h.result !== null && h.actions.some((a) => a.isAutomatic))).toBe(true);
  });

  it('„Nochmal“ (D-020): zweite Runde am selben Tisch, Tisch dazwischen geschlossen und wieder geöffnet', async () => {
    const ids = await users('wp015_nia', 'wp015_nils', 'wp015_noa');
    const t = setup({ seed: 6 });
    const tableId = await t.startTable(ids);
    t.playToEnd(tableId, createSeededRng(5));
    await t.game.idle();
    const tableStatus = async () =>
      (await s.pool.query<TableRow>('SELECT status, closed_at FROM tables WHERE id = $1', [tableId])).rows[0];
    expect(await tableStatus()).toMatchObject({ status: 'closed', closed_at: expect.any(Date) as Date });

    await t.send(ids[0] as number, { type: 'table.rematch', tableId });
    await t.game.idle();
    expect(await tableStatus()).toMatchObject({ status: 'running', closed_at: null });
    t.playToEnd(tableId, createSeededRng(6));
    await t.game.idle();
    expect(t.errors).toEqual([]);

    const { rows: rounds } = await s.pool.query<RoundRow>(
      'SELECT * FROM rounds WHERE table_id = $1 ORDER BY started_at, id',
      [tableId],
    );
    expect(rounds.map((r) => r.status)).toEqual(['finished', 'finished']);
    for (const r of rounds) {
      const { rows } = await s.pool.query<RoundPlayerRow>('SELECT * FROM round_players WHERE round_id = $1', [r.id]);
      expect(rows.map((p) => p.user_id).sort()).toEqual([...ids].sort());
      expect(rows.every((p) => p.placement !== null && p.points !== null)).toBe(true);
      expect((await loadRoundHands(s.pool, r.id)).length).toBeGreaterThan(0);
    }
    expect(await tableStatus()).toMatchObject({ status: 'closed' });
    const points = await loadUserPoints(s.pool, ids);
    expect(points.every((p) => p.rounds === 2)).toBe(true);
  });
});
