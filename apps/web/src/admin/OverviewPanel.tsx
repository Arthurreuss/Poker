// /admin (Übersicht, WP-029): Tische, Spieler online, Runden heute/7 Tage, offenes Feedback, Server-Health.
// Lädt alle 30 s neu. Das letzte Backup sieht der Server nicht (ARCHITECTURE.md, „Admin-Dashboard (WP-029)“) –
// Hinweis auf `npm run prod:status`.
import { useEffect } from 'react';
import { Link } from 'react-router';
import { getAdminOverview, type AdminOverview, type RoundCounts } from '../api/admin';
import { LoadState, formatDateTime, formatDuration, useLoad } from './common';
import styles from './Dashboard.module.css';

export const OVERVIEW_REFRESH_MS = 30_000;

function roundDetail(c: RoundCounts): string {
  const parts = [`${String(c.finished)} beendet`];
  if (c.aborted > 0) parts.push(`${String(c.aborted)} abgebrochen`);
  if (c.running > 0) parts.push(`${String(c.running)} laufend`);
  return parts.join(', ');
}

function Tile({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className={styles.tile}>
      <dt>{label}</dt>
      <dd className={tone === undefined ? undefined : styles[tone]}>
        {value}
        {detail !== undefined && <span className={styles.tileDetail}> · {detail}</span>}
      </dd>
    </div>
  );
}

function Overview({ data }: { data: AdminOverview }) {
  const { tables, rounds, health } = data;
  return (
    <>
      <dl className={styles.tiles} aria-label="Kennzahlen">
        <Tile
          label="Aktive Tische"
          value={String(tables.total)}
          detail={`${String(tables.running)} laufend, ${String(tables.open)} offen`}
        />
        <Tile
          label="Spieler online"
          value={String(data.onlineUsers)}
          detail={`${String(tables.seatedPlayers)} am Tisch`}
        />
        <Tile
          label="Runden heute"
          value={rounds === null ? '–' : String(rounds.today.started)}
          {...(rounds === null ? {} : { detail: roundDetail(rounds.today) })}
        />
        <Tile
          label={`Runden ${String(rounds?.weekDays ?? 7)} Tage`}
          value={rounds === null ? '–' : String(rounds.week.started)}
          {...(rounds === null ? {} : { detail: roundDetail(rounds.week) })}
        />
        <Tile label="Neues Feedback" value={data.feedbackNew === null ? '–' : String(data.feedbackNew)} />
      </dl>

      <h3 className={styles.title}>Server</h3>
      <dl className={styles.tiles} aria-label="Server-Health">
        <Tile
          label="Datenbank"
          value={health.db === 'ok' ? 'OK' : 'Fehler'}
          tone={health.db === 'ok' ? 'ok' : 'bad'}
          {...(health.dbLatencyMs === null ? {} : { detail: `${String(health.dbLatencyMs)} ms` })}
        />
        <Tile label="Läuft seit" value={formatDuration(health.uptimeSeconds)} />
        <Tile label="Speicher" value={`${String(health.memoryMb)} MB`} detail={`Node ${health.nodeVersion}`} />
      </dl>
      <p className={styles.muted}>
        Letztes Backup: sieht der Server nicht (die Backups liegen nur auf dem Mac) – auf dem Mac{' '}
        <code>npm run prod:status</code> ausführen.
      </p>
      <p className={styles.muted}>
        Stand {formatDateTime(data.generatedAt)}
        {rounds === null ? '' : ` · „heute“ in ${rounds.timeZone}`}
      </p>
    </>
  );
}

export function OverviewPanel() {
  const { load, reload } = useLoad((signal) => getAdminOverview(signal), 'overview');

  useEffect(() => {
    const timer = setInterval(reload, OVERVIEW_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [reload]);

  return (
    <section className={styles.section} aria-labelledby="admin-overview-title">
      <div className={styles.sectionHead}>
        <h2 id="admin-overview-title" className={styles.title}>
          Übersicht
        </h2>
        <button type="button" className={styles.button} onClick={reload}>
          Aktualisieren
        </button>
      </div>
      <LoadState load={load} />
      {load.kind === 'ready' && <Overview data={load.data} />}
      {load.kind === 'ready' && load.data.tables.total > 0 && (
        <p>
          <Link to="tables">Zu den Tischen</Link>
        </p>
      )}
    </section>
  );
}
