import { Card } from '../Card';
import type { CelebrationView } from '../types';
import { COIN_CLIPS, CONFETTI_CLIPS } from './clips';
import { LottieClip } from './LottieClip';
import './celebrate.css';

export interface CelebrationProps {
  readonly celebration: CelebrationView;
  readonly fourColor?: boolean;
  /** Animationen an (Einstellung und kein `prefers-reduced-motion`); sonst nur der Schriftzug. */
  readonly animate: boolean;
}

/**
 * Feier nach einer Hand (WP-040), als Ebene über der Tischfläche: Konfetti (je Hand ein anderes), in der Mitte ein
 * Schriftzug mit der Gewinnerhand und deren fünf Karten in einer Reihe, darunter Münzen nach Pot-Größe.
 * Der Schriftzug kommt auch ohne Animationen; Lottie-Animationen nur mit `animate`.
 */
export function Celebration({ celebration, fourColor = false, animate }: CelebrationProps) {
  const { title, detail, cards, coins } = celebration;
  const confetti = CONFETTI_CLIPS[celebration.confetti % CONFETTI_CLIPS.length];
  const [small, stack, rain] = COIN_CLIPS;
  return (
    <div className={`cel-layer${animate ? ' cel-layer--anim' : ''}`} data-testid="celebration" data-coins={coins}>
      {animate && confetti !== undefined && <LottieClip clip={confetti} className="cel-clip cel-clip--confetti" />}
      {animate && coins >= 3 && rain !== undefined && (
        <LottieClip clip={rain} className="cel-clip cel-clip--rain" delayMs={500} />
      )}
      <div className="cel-banner" role="status" data-testid="celebration-banner">
        <p className="cel-title">{title}</p>
        {cards !== undefined && cards.length > 0 && (
          <div className="cel-cards" data-testid="celebration-cards">
            {cards.map((card) => (
              <Card key={card} card={card} size="board" fourColor={fourColor} highlight="win" />
            ))}
          </div>
        )}
        <p className="cel-detail">{detail}</p>
        {animate && coins >= 1 && (
          <div className="cel-coins">
            {small !== undefined && <LottieClip clip={small} className="cel-clip cel-clip--coins" delayMs={200} />}
            {coins >= 2 && stack !== undefined && (
              <LottieClip clip={stack} className="cel-clip cel-clip--coins" delayMs={350} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
