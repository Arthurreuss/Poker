// Profil eines Spielers (WP-019): Punkte, Platz, Spielstil-Statistiken und letzte Runden.
import { Link, useParams } from 'react-router';
import { fetchPlayerStats, fetchRecentRounds, type RoundSummary } from '../api/stats';
import { useAuth } from '../auth/AuthContext';
import {
  formatDate,
  formatNumber,
  formatRate,
  handsLabel,
  placementLabel,
  playerName,
  pointsLabel,
} from '../stats/format';
import { ResourceView, Tile } from '../stats/parts';
import styles from '../stats/Stats.module.css';
import { useResource } from '../stats/useResource';
import { PlaceholderPage } from './PlaceholderPage';

/** Eine Runde; `subject` = Spieler des Profils (Name) oder `null` für das eigene Profil. */
function RoundItem({ round, subject }: { round: RoundSummary; subject: string | null }) {
  const p =
    subject === null
      ? round.players.find((x) => x.isViewer)
      : round.players.find((x) => x.name?.toLowerCase() === subject.toLowerCase());
  const content = (
    <>
      <div className={styles.row}>
        <span className={styles.strong}>{round.tableName}</span>
        <span className={styles.muted}>{formatDate(round.finishedAt)}</span>
      </div>
      <div className={styles.rowStart}>
        {round.status === 'aborted' ? (
          <span className={styles.badge}>abgebrochen, ohne Punkte</span>
        ) : (
          <span>
            {round.players.length} Spieler · Sieger: {playerName(round.players[0]?.name ?? null)}
          </span>
        )}
        <span className={styles.muted}>{handsLabel(round.handCount)}</span>
      </div>
      {p !== undefined && round.status === 'finished' && (
        <span className={styles.muted}>
          {subject ?? 'Du'}: Platz {placementLabel(p, round.players)} · {pointsLabel(p.points ?? 0)}
        </span>
      )}
    </>
  );
  // Der Server liefert nur Runden, deren Ergebnis der Betrachter sehen darf (D-024): eigene und öffentliche.
  return (
    <li>
      {round.viewerParticipated || round.isPublic ? (
        <Link className={styles.card} to={`/rounds/${String(round.id)}`}>
          {content}
        </Link>
      ) : (
        <div className={styles.card}>{content}</div>
      )}
    </li>
  );
}

export function PlayerPage() {
  const { name = '' } = useParams();
  const { user } = useAuth();
  const isSelf = user?.username.toLowerCase() === name.toLowerCase();
  const stats = useResource(`stats:${name}`, (signal) => fetchPlayerStats(name, signal), { refetchOnFocus: true });
  const rounds = useResource(`rounds:${name}`, (signal) => fetchRecentRounds(isSelf ? undefined : name, signal), {
    refetchOnFocus: true,
  });

  return (
    <PlaceholderPage title={isSelf ? 'Meine Statistiken' : `Spieler ${name}`}>
      <Link className={styles.back} to="/leaderboard">
        ← Rangliste
      </Link>
      <ResourceView resource={stats}>
        {(s) => (
          <>
            <section className={styles.section} aria-label="Rangliste">
              <div className={styles.tiles}>
                <Tile label="Platz" value={s.rank === null ? '–' : `${String(s.rank)}.`} />
                <Tile label="Punkte" value={formatNumber(s.points)} />
                <Tile label="Runden" value={formatNumber(s.rounds)} />
                <Tile label="Siege" value={formatNumber(s.wins)} />
              </div>
            </section>
            <section className={styles.section} aria-label="Spielstil">
              <h2 className={styles.sectionTitle}>Spielstil</h2>
              <div className={styles.tiles}>
                <Tile label="Hände" value={formatNumber(s.hands.hands)} />
                <Tile label="VPIP" value={formatRate(s.hands.vpip)} hint="Freiwillig Chips investiert (preflop)" />
                <Tile label="PFR" value={formatRate(s.hands.pfr)} hint="Preflop erhöht" />
                <Tile label="Showdown" value={formatRate(s.hands.wtsd)} hint="Showdowns je gesehenem Flop (WTSD)" />
                <Tile label="Showdown gewonnen" value={formatRate(s.hands.wsd)} hint="Gewonnene Showdowns (W$SD)" />
              </div>
              <p className={styles.muted}>
                Nur beendete Runden. Hände, in denen du nicht da warst (automatisch gefoldet/gecheckt), zählen nur bei
                „Hände“.
              </p>
            </section>
          </>
        )}
      </ResourceView>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Letzte Runden</h2>
        <ResourceView resource={rounds}>
          {(list) =>
            list.length === 0 ? (
              <p className={styles.muted}>Noch keine Runden.</p>
            ) : (
              <ul className={styles.list}>
                {list.map((r) => (
                  <RoundItem key={r.id} round={r} subject={isSelf ? null : name} />
                ))}
              </ul>
            )
          }
        </ResourceView>
      </section>
    </PlaceholderPage>
  );
}
