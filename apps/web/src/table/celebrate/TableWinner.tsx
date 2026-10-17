import { Avatar } from '../../avatars/Avatar';
import { WINNER_CLIP } from './clips';
import { LottieClip } from './LottieClip';
import './celebrate.css';

export interface TableWinnerProps {
  /** Erster Platz der Runde; bei geteiltem ersten Platz mehrere (D-018). */
  readonly winners: readonly { readonly name: string; readonly avatar: string | null }[];
  readonly animate: boolean;
}

/**
 * Sieger des ganzen Tisches (WP-040): nach der letzten Hand Pokal-Animation, Avatar und Name groß in der Mitte,
 * danach der Rundenende-Dialog (`game/roundEndHold.ts`). Ein Tipp überspringt.
 */
export function TableWinner({ winners, animate }: TableWinnerProps) {
  const names = winners.map((w) => w.name).join(' und ');
  return (
    <div
      className={`cel-winner${animate ? ' cel-winner--anim' : ''}`}
      role="status"
      aria-label={`${names} ${winners.length > 1 ? 'gewinnen' : 'gewinnt'} den Tisch`}
      data-testid="table-winner"
    >
      {animate && <LottieClip clip={WINNER_CLIP} className="cel-clip cel-clip--trophy" />}
      <div className="cel-winner-people">
        {winners.map((w) => (
          <div key={w.name} className="cel-winner-person">
            <Avatar avatar={w.avatar} name={w.name} className="cel-winner-avatar" decorative />
            <p className="cel-winner-name">{w.name}</p>
          </div>
        ))}
      </div>
      <p className="cel-winner-text">{winners.length > 1 ? 'gewinnen den Tisch!' : 'gewinnt den Tisch!'}</p>
    </div>
  );
}
