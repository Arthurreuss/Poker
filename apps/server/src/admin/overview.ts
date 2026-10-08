// Lese-Endpunkte fürs Admin-Dashboard (WP-029): Übersicht (Tische, Spieler online, Runden, offenes Feedback,
// Server-Health) und die Tische im Speicher. Nur lesend – nichts davon kommt ins Admin-Protokoll (D-029).
// Das letzte Backup fehlt bewusst: der Server sieht den Backup-Ordner nicht (ARCHITECTURE.md,
// „Admin-Dashboard (WP-029)“).
import type { Database, Queryable } from '../db';
import type { GameServer } from '../game/game-server';
import type { Table } from '../game/table';

/** Zeitzone für „heute“ (Freunde in Deutschland, wie der Backup-Zeitplan `BACKUP_TZ`). */
export const OVERVIEW_TIME_ZONE = 'Europe/Berlin';
/** „Woche“ = die letzten 7 Tage (gleitend), damit die Zahl auch montags aussagekräftig ist. */
export const OVERVIEW_WEEK_DAYS = 7;

export interface RoundCounts {
  /** In diesem Zeitraum gestartete Runden … */
  started: number;
  /** … davon regulär beendet (mit Punkten), */
  finished: number;
  /** … ohne Punkte abgebrochen (Neustart, verwaist, Admin), */
  aborted: number;
  /** … und noch laufend. */
  running: number;
}

export interface AdminOverview {
  /** ISO-Zeitpunkt der Erhebung. */
  generatedAt: string;
  tables: {
    /** Tische im Speicher (offen oder laufend). */
    total: number;
    open: number;
    running: number;
    /** Verschiedene Spieler mit Sitz an irgendeinem Tisch. */
    seatedPlayers: number;
  };
  /** Verschiedene User mit mindestens einer offenen WebSocket-Verbindung. */
  onlineUsers: number;
  /** `null`, wenn die Datenbank nicht erreichbar ist. */
  rounds: { today: RoundCounts; week: RoundCounts; timeZone: string; weekDays: number } | null;
  /** Feedback mit Status „neu“; `null` ohne Datenbank. */
  feedbackNew: number | null;
  health: {
    db: 'ok' | 'error';
    /** Dauer von `SELECT 1` in ms; `null` bei Fehler. */
    dbLatencyMs: number | null;
    uptimeSeconds: number;
    nodeVersion: string;
    /** Resident Set Size des Server-Prozesses in MB. */
    memoryMb: number;
  };
}

export interface AdminTablePlayer {
  seat: number;
  id: number;
  username: string;
  /** Beobachtet den Tisch gerade (Verbindungsstatus wie am Tisch, WP-012). */
  connected: boolean;
}

export interface AdminTable {
  id: number;
  name: string;
  isPublic: boolean;
  status: 'open' | 'running' | 'finished';
  createdBy: { id: number; username: string };
  maxSeats: number;
  players: AdminTablePlayer[];
  /** Verbindungen (User), die den Tisch beobachten – Spieler und Zuschauer. */
  watchers: number;
  roundId: number | null;
  /** Nummer der laufenden Hand; `null` ohne Runde. */
  handNumber: number | null;
}

export interface OverviewSources {
  db: Database;
  /** Für die Warnung, wenn die Datenbank nicht antwortet. */
  log: { warn: (obj: object, msg: string) => void };
  game: GameServer;
  onlineUserIds: () => ReadonlySet<number>;
  /** Standard: jetzt. */
  now?: Date;
}

/** Tische im Speicher (ohne geschlossene), nach ID sortiert. */
export function listAdminTables(game: GameServer): AdminTable[] {
  return game
    .tableIds()
    .map((id) => game.getTable(id))
    .filter((t): t is Table => t !== undefined && !t.isClosed)
    .sort((a, b) => a.id - b.id)
    .map((t) => ({
      id: t.id,
      name: t.settings.name,
      isPublic: t.settings.isPublic,
      status: t.status,
      createdBy: { id: t.createdBy.id, username: t.createdBy.username },
      maxSeats: t.settings.maxSeats,
      players: [...t.seats]
        .sort(([a], [b]) => a - b)
        .map(([seat, user]) => ({ seat, id: user.id, username: user.username, connected: t.isConnected(user.id) })),
      watchers: t.watcherCount,
      roundId: t.roundId,
      handNumber: t.round?.handNumber ?? null,
    }));
}

interface RoundCountRow {
  today_started: number;
  today_finished: number;
  today_aborted: number;
  today_running: number;
  week_started: number;
  week_finished: number;
  week_aborted: number;
  week_running: number;
}

/**
 * Runden, die seit Mitternacht (`timeZone`) bzw. in den letzten `weekDays` Tagen vor `now` gestartet wurden, nach
 * Status. Gezählt wird nach `started_at`, damit eine Runde genau einem Tag zugeordnet ist.
 */
export async function countRounds(
  db: Queryable,
  now: Date,
  timeZone = OVERVIEW_TIME_ZONE,
  weekDays = OVERVIEW_WEEK_DAYS,
): Promise<{ today: RoundCounts; week: RoundCounts }> {
  const { rows } = await db.query<RoundCountRow>(
    `WITH b AS (
       SELECT date_trunc('day', $1::timestamptz AT TIME ZONE $2) AT TIME ZONE $2 AS today,
              $1::timestamptz - make_interval(days => $3::int) AS week,
              $1::timestamptz AS until
     )
     SELECT
       count(r.id) FILTER (WHERE r.started_at >= b.today)::int AS today_started,
       count(r.id) FILTER (WHERE r.started_at >= b.today AND r.status = 'finished')::int AS today_finished,
       count(r.id) FILTER (WHERE r.started_at >= b.today AND r.status = 'aborted')::int AS today_aborted,
       count(r.id) FILTER (WHERE r.started_at >= b.today AND r.status = 'running')::int AS today_running,
       count(r.id) FILTER (WHERE r.started_at >= b.week)::int AS week_started,
       count(r.id) FILTER (WHERE r.started_at >= b.week AND r.status = 'finished')::int AS week_finished,
       count(r.id) FILTER (WHERE r.started_at >= b.week AND r.status = 'aborted')::int AS week_aborted,
       count(r.id) FILTER (WHERE r.started_at >= b.week AND r.status = 'running')::int AS week_running
     FROM b
     LEFT JOIN rounds r ON r.started_at >= least(b.today, b.week) AND r.started_at <= b.until
     GROUP BY b.today, b.week`,
    [now.toISOString(), timeZone, weekDays],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Rundenzählung ohne Ergebnis');
  return {
    today: {
      started: row.today_started,
      finished: row.today_finished,
      aborted: row.today_aborted,
      running: row.today_running,
    },
    week: {
      started: row.week_started,
      finished: row.week_finished,
      aborted: row.week_aborted,
      running: row.week_running,
    },
  };
}

async function countNewFeedback(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM feedback WHERE status = 'new'`);
  return rows[0]?.n ?? 0;
}

export async function loadOverview({
  db,
  log,
  game,
  onlineUserIds,
  now = new Date(),
}: OverviewSources): Promise<AdminOverview> {
  const tables = listAdminTables(game);
  const seated = new Set(tables.flatMap((t) => t.players.map((p) => p.id)));

  let dbStatus: 'ok' | 'error' = 'ok';
  let dbLatencyMs: number | null = null;
  let rounds: AdminOverview['rounds'] = null;
  let feedbackNew: number | null = null;
  try {
    const start = performance.now();
    await db.ping();
    dbLatencyMs = Math.round((performance.now() - start) * 10) / 10;
    const [counts, fb] = await Promise.all([countRounds(db, now), countNewFeedback(db)]);
    rounds = { ...counts, timeZone: OVERVIEW_TIME_ZONE, weekDays: OVERVIEW_WEEK_DAYS };
    feedbackNew = fb;
  } catch (err) {
    log.warn({ err }, 'Admin-Übersicht: Datenbank nicht erreichbar');
    dbStatus = 'error';
  }

  return {
    generatedAt: now.toISOString(),
    tables: {
      total: tables.length,
      open: tables.filter((t) => t.status === 'open').length,
      running: tables.filter((t) => t.status === 'running').length,
      seatedPlayers: seated.size,
    },
    onlineUsers: onlineUserIds().size,
    rounds,
    feedbackNew,
    health: {
      db: dbStatus,
      dbLatencyMs: dbStatus === 'ok' ? dbLatencyMs : null,
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      memoryMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    },
  };
}
