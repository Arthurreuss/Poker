// Rangliste (WP-019): Punkte, Runden, Siege. Lädt bei jedem Aufruf und wenn die App wieder in den Vordergrund
// kommt neu – so ist sie nach einem Rundenende aktuell, ohne Push (ARCHITECTURE.md, „Statistiken“).
// Nur Spieler mit mindestens einer beendeten Runde (D-024); der Server filtert, die Seite zur Sicherheit auch.
import { Link } from 'react-router';
import { fetchLeaderboard } from '../api/stats';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../avatars/Avatar';
import { formatNumber, isSharedRank } from '../stats/format';
import { PlayerLink, ResourceView } from '../stats/parts';
import styles from '../stats/Stats.module.css';
import { useResource } from '../stats/useResource';
import { cx } from '../styles/cx';
import { PlaceholderPage } from './PlaceholderPage';

export function LeaderboardPage() {
  const { user } = useAuth();
  const resource = useResource('leaderboard', fetchLeaderboard, { refetchOnFocus: true });

  return (
    <PlaceholderPage title="Rangliste">
      {user !== null && (
        <div className={styles.toolbar}>
          <Link className={styles.link} to={`/players/${encodeURIComponent(user.username)}`}>
            Meine Statistiken und Hände
          </Link>
        </div>
      )}
      <ResourceView resource={resource}>
        {(all) => {
          const players = all.filter((p) => p.rounds > 0);
          return players.length === 0 ? (
            <p className={styles.muted}>Noch keine beendeten Runden.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.rank} scope="col">
                    #
                  </th>
                  <th className={styles.name} scope="col">
                    Spieler
                  </th>
                  <th scope="col">Punkte</th>
                  <th scope="col">Runden</th>
                  <th scope="col">Siege</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const shared = isSharedRank(p, players);
                  const own = p.userId === user?.id;
                  return (
                    <tr key={p.userId} className={cx(own && styles.own)} aria-current={own ? 'true' : undefined}>
                      <td className={styles.rank} title={shared ? 'geteilter Platz' : undefined}>
                        {p.rank}.
                      </td>
                      <td className={styles.name}>
                        <span className={styles.who}>
                          <Avatar avatar={p.avatar} name={p.name} decorative className={styles.avatarSmall} />
                          <span>
                            <PlayerLink name={p.name} />
                            {own && <span className={styles.muted}> (du)</span>}
                          </span>
                        </span>
                      </td>
                      <td className={styles.strong}>{formatNumber(p.points)}</td>
                      <td>{formatNumber(p.rounds)}</td>
                      <td>{formatNumber(p.wins)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        }}
      </ResourceView>
      <p className={styles.muted}>
        Punkte je Runde: Platz k von n Spielern bekommt n − k, der Sieger 1 extra. Gleiche Punkte = gleicher Platz.
      </p>
    </PlaceholderPage>
  );
}
