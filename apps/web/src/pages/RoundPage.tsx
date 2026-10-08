// Eine Runde (WP-019): Ergebnis mit (geteilten) Plätzen und die Hände zum Nachlesen – nur für Teilnehmer.
import { Link, useParams } from 'react-router';
import { fetchRound } from '../api/stats';
import { formatDate, formatNet, formatNumber, placementLabel, playerName, pointsLabel } from '../stats/format';
import { Cards, PlayerLink, ResourceView } from '../stats/parts';
import styles from '../stats/Stats.module.css';
import { useResource } from '../stats/useResource';
import { cx } from '../styles/cx';
import { PlaceholderPage } from './PlaceholderPage';

export function RoundPage() {
  const { id = '' } = useParams();
  const resource = useResource(`round:${id}`, (signal) => fetchRound(id, signal));

  return (
    <PlaceholderPage title="Runde">
      <Link className={styles.back} to="/leaderboard">
        ← Rangliste
      </Link>
      <ResourceView resource={resource}>
        {({ round, hands }) => (
          <>
            <div className={styles.row}>
              <span className={styles.strong}>{round.tableName}</span>
              <span className={styles.muted}>{formatDate(round.finishedAt)}</span>
            </div>
            {round.status === 'aborted' && (
              <p className={styles.notice}>Abgebrochen – diese Runde zählt nicht für Punkte und Statistiken.</p>
            )}
            <section className={styles.section} aria-label="Ergebnis">
              <ol className={styles.list}>
                {round.players.map((p) => (
                  <li key={p.seat} className={cx(styles.card, p.isViewer && styles.ownCard)}>
                    <div className={styles.row}>
                      <span>
                        {p.placement !== null && `${placementLabel(p, round.players)} `}
                        <PlayerLink name={p.name} />
                      </span>
                      {p.points !== null && <span>{pointsLabel(p.points)}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Hände ({hands.length})</h2>
              {hands.length === 0 ? (
                <p className={styles.muted}>Keine gespeicherten Hände.</p>
              ) : (
                <ul className={styles.list}>
                  {hands.map((h) => (
                    <li key={h.id}>
                      <Link className={styles.card} to={`/hands/${String(h.id)}`}>
                        <div className={styles.row}>
                          <span className={styles.rowStart}>
                            <span className={styles.strong}>#{h.handNumber}</span>
                            {h.viewer !== null && <Cards cards={h.viewer.holeCards} />}
                          </span>
                          {h.viewer !== null && (
                            <span
                              className={h.viewer.net > 0 ? styles.win : h.viewer.net < 0 ? styles.loss : undefined}
                            >
                              {formatNet(h.viewer.net)}
                            </span>
                          )}
                        </div>
                        <div className={styles.row}>
                          <Cards cards={h.board} />
                          <span className={styles.muted}>
                            {h.winners.map((w) => `${playerName(w.name)} +${formatNumber(w.amount)}`).join(', ')}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </ResourceView>
    </PlaceholderPage>
  );
}
