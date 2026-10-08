// Eine Hand zum Nachlesen (WP-019): Spieler mit Karten (fremde nur, wenn gezeigt – filtert der Server, D-003),
// Aktionen je Straße mit Board, Pots und Gewinner.
import { Link, useParams } from 'react-router';
import { fetchHand, type HandDetail, type Street } from '../api/stats';
import { actionLabel, formatNet, formatNumber, playerName, STREET_LABELS } from '../stats/format';
import { Cards, PlayerLink, ResourceView } from '../stats/parts';
import styles from '../stats/Stats.module.css';
import { useResource } from '../stats/useResource';
import { cx } from '../styles/cx';
import { PlaceholderPage } from './PlaceholderPage';

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];
/** Board-Karten, die bis zu dieser Straße liegen. */
const BOARD_SIZE: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

function positionLabel(hand: HandDetail, seat: number): string {
  const labels: string[] = [];
  if (seat === hand.buttonSeat) labels.push('D');
  if (seat === hand.smallBlindSeat) labels.push('SB');
  if (seat === hand.bigBlindSeat) labels.push('BB');
  return labels.join('/');
}

function Hand({ hand }: { hand: HandDetail }) {
  return (
    <>
      <div className={styles.row}>
        <Link className={styles.back} to={`/rounds/${String(hand.roundId)}`}>
          ← Runde
        </Link>
        <span className={styles.muted}>
          Blinds {formatNumber(hand.smallBlind)}/{formatNumber(hand.bigBlind)}
        </span>
      </div>

      <section className={styles.section} aria-label="Spieler">
        <ul className={styles.list}>
          {hand.players.map((p) => {
            const net = p.endStack - p.startStack;
            const pos = positionLabel(hand, p.seat);
            return (
              <li key={p.seat} className={cx(styles.card, p.isViewer && styles.ownCard)} data-seat={p.seat}>
                <div className={styles.row}>
                  <span className={styles.rowStart}>
                    <PlayerLink name={p.name} />
                    {pos !== '' && <span className={styles.badge}>{pos}</span>}
                    <Cards cards={p.holeCards} count={2} />
                  </span>
                  <span className={net > 0 ? styles.win : net < 0 ? styles.loss : undefined}>{formatNet(net)}</span>
                </div>
                <span className={styles.muted}>
                  {[
                    p.handDescription ?? (p.cards === 'mucked' ? 'nicht gezeigt' : p.folded ? 'gefoldet' : null),
                    `Stack ${formatNumber(p.startStack)} → ${formatNumber(p.endStack)}`,
                  ]
                    .filter((x) => x !== null)
                    .join(' · ')}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {STREETS.map((street) => {
        const actions = hand.actions.filter((a) => a.street === street);
        const board = hand.board.slice(0, BOARD_SIZE[street]);
        if (actions.length === 0 && board.length < BOARD_SIZE[street]) return null;
        return (
          <section key={street} className={styles.street} aria-label={STREET_LABELS[street]}>
            <div className={styles.rowStart}>
              <span className={styles.strong}>{STREET_LABELS[street]}</span>
              <Cards cards={board} />
            </div>
            <ol className={styles.actions}>
              {actions.map((a) => (
                <li key={a.seq} className={cx(a.isAutomatic && styles.auto)}>
                  {playerName(a.name)} {actionLabel(a)}
                  {a.isAutomatic && ' (automatisch)'}
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      <section className={styles.section} aria-label="Ergebnis">
        <h2 className={styles.sectionTitle}>{hand.showdown ? 'Showdown' : 'Ergebnis'}</h2>
        {hand.pots.length > 0 ? (
          <ul className={styles.list}>
            {hand.pots.map((pot, i) => (
              <li key={i} className={styles.card}>
                <span className={styles.strong}>
                  {hand.pots.length === 1 ? 'Pot' : i === 0 ? 'Main Pot' : `Side Pot ${String(i)}`}{' '}
                  {formatNumber(pot.amount)}
                </span>
                <span>
                  {pot.winners.map((w) => `${playerName(w.name)} +${formatNumber(w.amount)}`).join(', ')}
                  {pot.handDescription !== null && <span className={styles.muted}> – {pot.handDescription}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {hand.winners.map((w) => `${playerName(w.name)} gewinnt ${formatNumber(w.amount)}`).join(', ')} ohne
            Showdown.
          </p>
        )}
      </section>
    </>
  );
}

export function HandPage() {
  const { id = '' } = useParams();
  const resource = useResource(`hand:${id}`, (signal) => fetchHand(id, signal));
  const title = resource.status === 'ok' ? `Hand #${String(resource.data.handNumber)}` : 'Hand';
  return (
    <PlaceholderPage title={title}>
      <ResourceView resource={resource}>{(hand) => <Hand hand={hand} />}</ResourceView>
    </PlaceholderPage>
  );
}
