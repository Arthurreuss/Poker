// Rangliste, Statistiken und Hand-Historie gegen Postgres (WP-019). Hände stammen aus Zufallsrunden der Engine und
// werden über den Store aus WP-013 gespeichert. Nur mit TEST_DATABASE_URL: `npm run test:db -w @poker/server`.
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { SESSION_COOKIE, createSession } from '../auth/session';
import { createPgDatabase } from '../db';
import { runMigrations } from '../db/migrate';
import { createTestSchema, testDatabaseUrl, type TestSchema } from '../db/test-db';
import { toHandRecord } from '../history/records';
import { createPgHandHistoryStore, loadRoundHands } from '../history/store';
import { loadLeaderboard, loadPlayerHands } from './queries';
import { aggregateHandStats, playerHandFromRecord, type PlayerHand } from './stats';
import { playRandomRound } from './test-rounds';
import type { HandView } from './view';

/** Antwort mit erwarteter Form (Tests casten den Body). */
type Res<T> = { status: number; body: T };

const AUTH: AuthConfig = {
  secureCookies: false,
  trustCfConnectingIp: false,
  sessionTtlMs: 86_400_000,
  rateLimit: null,
};

describe.skipIf(testDatabaseUrl === undefined)('Statistiken mit Postgres', () => {
  let s: TestSchema;
  let app: FastifyInstance | undefined;

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

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function users(...names: string[]): Promise<number[]> {
    const { rows } = await s.pool.query<{ id: number }>(
      `INSERT INTO users (username, password_hash) SELECT n, 'x' FROM unnest($1::text[]) AS n RETURNING id`,
      [names],
    );
    return rows.map((r) => r.id);
  }

  async function deleteUser(id: number): Promise<void> {
    await s.pool.query('UPDATE users SET username = NULL, password_hash = NULL, deleted_at = now() WHERE id = $1', [
      id,
    ]);
  }

  /**
   * Runde mit Status `status` speichern. `placements` je Spieler (Reihenfolge wie `ids`) für beendete Runden,
   * Punkte nach D-012 vereinfacht als n − Platz (+1 Sieger). `seed` → Hände per Engine-Zufallsrunde.
   */
  async function round(
    ids: number[],
    status: 'finished' | 'aborted' | 'running',
    options: {
      placements?: number[];
      points?: number[];
      seed?: number;
      tableName?: string;
      finishedAt?: string;
      isPublic?: boolean;
    } = {},
  ): Promise<number> {
    const { rows: t } = await s.pool.query<{ id: number }>(
      `INSERT INTO tables (created_by, name, is_public, invite_code, starting_stack, small_blind, big_blind,
                           blind_structure, status, closed_at)
       VALUES ($1, $2, $3, md5(random()::text), 600, 10, 20, '{}', 'closed', now()) RETURNING id`,
      [ids[0], options.tableName ?? 'Testtisch', options.isPublic ?? true],
    );
    const finishedAt = status === 'running' ? null : (options.finishedAt ?? new Date().toISOString());
    const { rows: r } = await s.pool.query<{ id: number }>(
      `INSERT INTO rounds (table_id, status, started_at, finished_at)
       VALUES ($1, $2, coalesce($3::timestamptz, now()) - interval '1 hour', $3) RETURNING id`,
      [t[0]?.id, status, finishedAt],
    );
    const roundId = r[0]?.id ?? 0;
    for (const [seat, id] of ids.entries()) {
      const placement = status === 'finished' ? (options.placements?.[seat] ?? seat + 1) : null;
      const points =
        placement === null ? null : (options.points?.[seat] ?? ids.length - placement + (placement === 1 ? 1 : 0));
      await s.pool.query(
        'INSERT INTO round_players (round_id, user_id, seat, placement, points) VALUES ($1, $2, $3, $4, $5)',
        [roundId, id, seat, placement, points],
      );
    }
    if (options.seed !== undefined) {
      const store = createPgHandHistoryStore(s.pool);
      for (const [i, hand] of playRandomRound(options.seed, ids).entries()) {
        await store.saveHandCompleted(toHandRecord(roundId, i + 1, hand));
      }
    }
    return roundId;
  }

  async function start(): Promise<FastifyInstance> {
    app = buildApp({
      db: createPgDatabase({ ...s.config, max: 2 }),
      publicOrigin: 'http://localhost:4310',
      auth: AUTH,
    });
    await app.ready();
    return app;
  }

  async function cookieFor(userId: number): Promise<string> {
    const { token } = await createSession(s.pool, userId, 60_000);
    return `${SESSION_COOKIE}=${token}`;
  }

  async function get(a: FastifyInstance, url: string, cookie?: string): Promise<Res<unknown>> {
    const res = await a.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });
    return { status: res.statusCode, body: res.json() };
  }

  it('SQL-Statistik = reine Berechnung über die gespeicherten Hände beendeter Runden; Abbruch zählt nicht', async () => {
    const ids = await users('anna', 'ben', 'cleo', 'dora');
    const finished = [await round(ids, 'finished', { seed: 1 }), await round(ids.slice(0, 3), 'finished', { seed: 2 })];
    const aborted = await round(ids, 'aborted', { seed: 3 });
    const stored = (await Promise.all(finished.map((id) => loadRoundHands(s.pool, id)))).flat();
    // Unbeendete Hand einer beendeten Runde (darf es eigentlich nicht geben) zählt ebenfalls nicht.
    await s.pool.query(
      `INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind, players)
       VALUES ($1, 999, 0, 10, 20, '[]')`,
      [finished[0]],
    );
    expect((await loadRoundHands(s.pool, aborted)).length).toBeGreaterThan(0);

    for (const id of ids) {
      const expected = stored.map((h) => playerHandFromRecord(h, id)).filter((h): h is PlayerHand => h !== null);
      const fromSql = await loadPlayerHands(s.pool, id);
      expect(fromSql).toHaveLength(expected.length);
      expect(aggregateHandStats(fromSql)).toEqual(aggregateHandStats(expected));
    }
    // Plausibilität: die Zufallsrunden enthalten alle Fälle.
    const all = aggregateHandStats(
      stored.flatMap((h) => h.players.map((p) => playerHandFromRecord(h, p.userId) as PlayerHand)),
    );
    expect(all.vpip.count).toBeGreaterThan(0);
    expect(all.pfr.count).toBeGreaterThan(0);
    expect(all.wtsd.count).toBeGreaterThan(0);
    expect(all.wsd.count).toBeGreaterThan(0);
    expect(all.vpip.count).toBeLessThan(all.vpip.of);
  }, 30_000);

  it('Rangliste: Punkte, Runden, Siege, geteilte Plätze; ohne gelöschte Accounts, abgebrochene Runden und Spieler ohne beendete Runde', async () => {
    const [anna, ben, cleo, dora, emil, gone] = await users('anna', 'Ben', 'cleo', 'dora', 'emil', 'gone');
    if (anna === undefined || ben === undefined || cleo === undefined || dora === undefined || gone === undefined) {
      throw new Error('User fehlen');
    }
    // Runde 1: anna gewinnt (4), ben 2, cleo/dora teilen Platz 3 (D-018: je 0).
    await round([anna, ben, cleo, dora], 'finished', { placements: [1, 2, 3, 3], points: [4, 2, 0, 0] });
    // Runde 2: ben gewinnt (3), anna 1, gone 0.
    await round([ben, anna, gone], 'finished');
    // Abgebrochen und laufend: zählen nicht.
    await round([cleo, dora], 'aborted');
    await round([dora, cleo], 'running');
    await deleteUser(gone);

    const board = await loadLeaderboard(s.pool);
    expect(board.map((e) => [e.rank, e.name, e.points, e.rounds, e.wins])).toEqual([
      [1, 'anna', 5, 2, 1],
      [1, 'Ben', 5, 2, 1],
      [3, 'cleo', 0, 1, 0],
      [3, 'dora', 0, 1, 0],
    ]);
    expect(board.some((e) => e.userId === gone)).toBe(false);
    // D-024: emil hat keine beendete Runde → nicht in der Rangliste.
    expect(board.some((e) => e.userId === emil)).toBe(false);
  });

  it('API nur mit Session; Rangliste, Profil, letzte Runden mit gelöschtem Spieler', async () => {
    const [anna, ben, gone] = await users('anna', 'ben', 'gone');
    if (anna === undefined || ben === undefined || gone === undefined) throw new Error('User fehlen');
    const r1 = await round([anna, ben, gone], 'finished', {
      seed: 4,
      tableName: 'Erste',
      finishedAt: '2026-10-01T20:00:00Z',
    });
    const r2 = await round([anna, ben], 'aborted', {
      seed: 5,
      tableName: 'Zweite',
      finishedAt: '2026-10-02T20:00:00Z',
    });
    await round([anna, ben], 'running');
    await deleteUser(gone);
    const a = await start();

    for (const url of [
      '/api/leaderboard',
      '/api/players/anna/stats',
      '/api/rounds/recent',
      `/api/rounds/${String(r1)}`,
      '/api/hands/1',
    ]) {
      const res = (await get(a, url)) as Res<{ error: string }>;
      expect(res.status, url).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    }
    const cookie = await cookieFor(anna);

    const lb = (await get(a, '/api/leaderboard', cookie)) as Res<{ players: { name: string; points: number }[] }>;
    expect(lb.status).toBe(200);
    expect(lb.body.players.map((p) => [p.name, p.points])).toEqual([
      ['anna', 3],
      ['ben', 1],
    ]);

    const stats = (await get(a, '/api/players/ANNA/stats', cookie)) as Res<{
      player: { name: string };
      rank: number;
      rounds: number;
      wins: number;
      hands: { hands: number };
    }>;
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ player: { name: 'anna' }, rank: 1, rounds: 1, wins: 1 });
    const r1Hands = (await loadRoundHands(s.pool, r1)).length;
    expect(stats.body.hands.hands).toBe(r1Hands);
    expect((await get(a, '/api/players/gone/stats', cookie)).status).toBe(404);
    expect((await get(a, '/api/players/niemand/stats', cookie)).status).toBe(404);

    const recent = (await get(a, '/api/rounds/recent?player=ben&limit=5', cookie)) as Res<{
      rounds: {
        id: number;
        tableName: string;
        status: string;
        handCount: number;
        viewerParticipated: boolean;
        players: { name: string | null; placement: number | null; isViewer: boolean }[];
      }[];
    }>;
    expect(recent.status).toBe(200);
    expect(recent.body.rounds.map((r) => [r.id, r.tableName, r.status, r.viewerParticipated])).toEqual([
      [r2, 'Zweite', 'aborted', true],
      [r1, 'Erste', 'finished', true],
    ]);
    expect(recent.body.rounds[1]?.handCount).toBe(r1Hands);
    expect(recent.body.rounds[1]?.players.map((p) => [p.name, p.placement, p.isViewer])).toEqual([
      ['anna', 1, true],
      ['ben', 2, false],
      [null, 3, false],
    ]);
    expect((await get(a, '/api/rounds/recent?limit=0', cookie)).status).toBe(400);
    expect((await get(a, '/api/rounds/recent?limit=51', cookie)).status).toBe(400);
    expect((await get(a, '/api/rounds/recent?player=gone', cookie)).status).toBe(404);
  }, 30_000);

  it('Hand-Historie: nur für Teilnehmer, ohne Deck, fremde Karten nur wenn gezeigt', async () => {
    const [anna, ben, cleo, out] = await users('anna', 'ben', 'cleo', 'zaungast');
    if (anna === undefined || ben === undefined || cleo === undefined || out === undefined)
      throw new Error('User fehlen');
    const roundId = await round([anna, ben, cleo], 'finished', { seed: 6 });
    const running = await round([anna, ben], 'running');
    await s.pool.query(
      `INSERT INTO hands (round_id, hand_number, button_seat, small_blind, big_blind, players)
       VALUES ($1, 1, 0, 10, 20, '[]')`,
      [running],
    );
    await deleteUser(cleo);
    const a = await start();
    const cookie = await cookieFor(anna);

    const detail = (await get(a, `/api/rounds/${String(roundId)}`, cookie)) as Res<{
      round: { players: { name: string | null }[] };
      hands: { id: number; viewer: { holeCards: string[] } | null }[];
    }>;
    expect(detail.status).toBe(200);
    const stored = await loadRoundHands(s.pool, roundId);
    expect(detail.body.hands.map((h) => h.id)).toEqual(stored.map((h) => h.id));
    expect(detail.body.round.players.some((p) => p.name === null)).toBe(true);
    expect(detail.body.hands[0]?.viewer?.holeCards).toEqual(
      stored[0]?.players.find((p) => p.userId === anna)?.holeCards,
    );

    let shown = 0;
    let hidden = 0;
    for (const h of stored) {
      const res = await a.inject({ method: 'GET', url: `/api/hands/${String(h.id)}`, headers: { cookie } });
      expect(res.statusCode).toBe(200);
      const raw = res.body;
      expect(raw).not.toMatch(/deck/i);
      const { hand } = res.json<{ hand: HandView }>();
      // Karten, die niemand sehen durfte (Rest des Decks, fremde ungezeigte Hole Cards), tauchen nicht auf.
      const allowed = new Set<string>(h.board);
      for (const p of h.players) {
        const vis = h.result?.players.find((x) => x.userId === p.userId)?.cards;
        if (p.userId === anna || vis === 'shown') p.holeCards.forEach((c) => allowed.add(c));
        if (p.userId !== anna) {
          if (vis === 'shown') shown++;
          else hidden++;
        }
      }
      for (const c of raw.match(/"[2-9TJQKA][cdhs]"/g) ?? []) expect(allowed.has(c.slice(1, 3))).toBe(true);
      expect(hand.players.filter((p) => !p.isViewer && p.holeCards !== null).every((p) => p.cards === 'shown')).toBe(
        true,
      );
      expect(hand.players.find((p) => p.isViewer)?.holeCards).not.toBeNull();
      expect(hand.players.find((p) => p.seat === 2)?.name).toBeNull();
    }
    expect(shown).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);

    // Unbeteiligte (öffentlicher Tisch, D-024): Ergebnis ja, Hände nein; laufende Runde und Unsinn: 404.
    const outsider = await cookieFor(out);
    const outside = (await get(a, `/api/rounds/${String(roundId)}`, outsider)) as Res<{
      round: { id: number; isPublic: boolean; viewerParticipated: boolean; players: unknown[] };
      hands: unknown;
    }>;
    expect(outside.status).toBe(200);
    expect(outside.body.round).toMatchObject({ id: roundId, isPublic: true, viewerParticipated: false });
    expect(outside.body.round.players).toHaveLength(3);
    expect(outside.body.hands).toBeNull();
    expect((await get(a, `/api/hands/${String(stored[0]?.id)}`, outsider)).status).toBe(403);
    expect((await get(a, `/api/rounds/${String(running)}`, cookie)).status).toBe(404);
    const { rows } = await s.pool.query<{ id: number }>('SELECT id FROM hands WHERE round_id = $1', [running]);
    expect((await get(a, `/api/hands/${String(rows[0]?.id)}`, cookie)).status).toBe(404);
    expect((await get(a, '/api/hands/abc', cookie)).status).toBe(404);
    expect((await get(a, '/api/hands/999999', cookie)).status).toBe(404);
  }, 30_000);

  it('Private Tische (D-024): Ergebnis, Hände und „letzte Runden“ nur für Teilnehmer', async () => {
    const [anna, ben, cleo] = await users('anna', 'ben', 'cleo');
    if (anna === undefined || ben === undefined || cleo === undefined) throw new Error('User fehlen');
    const pub = await round([anna, ben], 'finished', {
      tableName: 'Offen',
      finishedAt: '2026-10-01T20:00:00Z',
      seed: 7,
    });
    const priv = await round([anna, ben], 'finished', {
      tableName: 'Geheim',
      finishedAt: '2026-10-02T20:00:00Z',
      isPublic: false,
      seed: 8,
    });
    const privAborted = await round([anna, cleo], 'aborted', {
      tableName: 'Geheim abgebrochen',
      finishedAt: '2026-10-03T20:00:00Z',
      isPublic: false,
    });
    const a = await start();
    const asAnna = await cookieFor(anna);
    const asCleo = await cookieFor(cleo);
    const ids = async (url: string, cookie: string) =>
      ((await get(a, url, cookie)) as Res<{ rounds: { id: number }[] }>).body.rounds.map((r) => r.id);

    // Teilnehmer sehen private Runden (eigene Liste und Profil des Mitspielers).
    expect(await ids('/api/rounds/recent', asAnna)).toEqual([privAborted, priv, pub]);
    expect(await ids('/api/rounds/recent?player=ben', asAnna)).toEqual([priv, pub]);
    const own = (await get(a, `/api/rounds/${String(priv)}`, asAnna)) as Res<{
      round: { isPublic: boolean };
      hands: unknown[];
    }>;
    expect(own.status).toBe(200);
    expect(own.body.round.isPublic).toBe(false);
    expect(own.body.hands.length).toBeGreaterThan(0);

    // Nicht-Teilnehmer: private Runden fehlen im Profil, Ergebnis und Hände → 403; öffentliche bleiben sichtbar.
    expect(await ids('/api/rounds/recent?player=ben', asCleo)).toEqual([pub]);
    expect(await ids('/api/rounds/recent?player=anna', asCleo)).toEqual([privAborted, pub]);
    const denied = (await get(a, `/api/rounds/${String(priv)}`, asCleo)) as Res<{ error: string }>;
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('forbidden');
    const { rows } = await s.pool.query<{ id: number }>('SELECT id FROM hands WHERE round_id = $1 LIMIT 1', [priv]);
    expect((await get(a, `/api/hands/${String(rows[0]?.id)}`, asCleo)).status).toBe(403);
    const open = (await get(a, `/api/rounds/${String(pub)}`, asCleo)) as Res<{ hands: unknown }>;
    expect(open.status).toBe(200);
    expect(open.body.hands).toBeNull();

    // Die Statistik-Zahlen enthalten private Runden weiterhin (nur Summen, keine einzelnen Ergebnisse).
    const stats = (await get(a, '/api/players/ben/stats', asCleo)) as Res<{ rounds: number }>;
    expect(stats.body.rounds).toBe(2);
  }, 30_000);

  it('Profil eines Spielers ohne beendete Runde: kein Platz (D-024)', async () => {
    const [anna, ben, neu] = await users('anna', 'ben', 'neu');
    if (anna === undefined || ben === undefined || neu === undefined) throw new Error('User fehlen');
    await round([anna, ben], 'finished');
    await round([neu, ben], 'aborted');
    const a = await start();
    const res = (await get(a, '/api/players/neu/stats', await cookieFor(anna))) as Res<{
      rank: number | null;
      rounds: number;
      points: number;
    }>;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rank: null, rounds: 0, points: 0 });
  }, 30_000);
});
