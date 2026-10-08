/**
 * Kartenvorder- und -rückseite als selbst gezeichnete SVGs (D-008), Herkunft: ../ASSETS.md.
 * Format 5:7 (viewBox 50×70). Großer Rang + Farbsymbol oben links und großes Farbsymbol unten
 * rechts, damit Karten auch sehr klein (≈ 30 px breit) noch lesbar sind.
 */
import { useId } from 'react';
import type { Card } from '../types';
import { cardSuit, rankLabel } from '../format';
import { SuitShape } from './suits';

/** Farbklasse eines Symbols; im Vier-Farben-Deck sind Karo blau und Kreuz grün. */
export function inkClass(card: Card, fourColor: boolean): string {
  const suit = cardSuit(card);
  if (fourColor && suit === 'd') return 'pt-ink-blue';
  if (fourColor && suit === 'c') return 'pt-ink-green';
  return suit === 'h' || suit === 'd' ? 'pt-ink-red' : 'pt-ink-black';
}

export function CardFaceSvg({ card, fourColor = false }: { card: Card; fourColor?: boolean }) {
  const ink = inkClass(card, fourColor);
  const rank = rankLabel(card);
  const suit = cardSuit(card);
  return (
    <svg viewBox="0 0 50 70" className="pt-card-svg" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="48.5" height="68.5" rx="4.5" className="pt-card-face-bg" />
      <text
        x={rank.length > 1 ? 2.5 : 4.5}
        y="21"
        className={`pt-card-rank ${ink}`}
        fontSize="21"
        letterSpacing={rank.length > 1 ? -2 : 0}
      >
        {rank}
      </text>
      <svg x="4.5" y="25" width="14" height="14" viewBox="0 0 100 100">
        <SuitShape suit={suit} className={ink} />
      </svg>
      <svg x="18" y="33" width="29" height="33" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <SuitShape suit={suit} className={ink} />
      </svg>
    </svg>
  );
}

/** Rückseite: eigenes Rautengitter mit Rahmen und Mittelmedaillon. */
export function CardBackSvg() {
  const patternId = `pt-back-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 50 70" className="pt-card-svg" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" className="pt-back-fill" />
          <path d="M0 0 H8 M0 0 V8" className="pt-back-line" strokeWidth="1.4" />
          <circle cx="4" cy="4" r="1.1" className="pt-back-dot" />
        </pattern>
      </defs>
      <rect x="0.75" y="0.75" width="48.5" height="68.5" rx="4.5" className="pt-back-frame" />
      <rect x="4" y="4" width="42" height="62" rx="2.5" fill={`url(#${patternId})`} />
      <rect x="4" y="4" width="42" height="62" rx="2.5" fill="none" className="pt-back-line" strokeWidth="1" />
      <circle cx="25" cy="35" r="8.5" className="pt-back-fill pt-back-line" strokeWidth="1.6" />
      <path d="M25 29 L30 35 L25 41 L20 35 Z" className="pt-back-dot" />
    </svg>
  );
}
