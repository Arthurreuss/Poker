/** Kleine Bausteine der Tischansicht: Einsatz-Chips, Dealer-Button/Blind-Marker, Board, Pots. */
import type { CSSProperties } from 'react';
import { ChipSvg, MarkerDiscSvg } from './assets/icons';
import { Card } from './Card';
import { formatChips } from './format';
import type { Card as CardValue, PotView } from './types';

/** Einsatz der laufenden Straße vor dem Sitz. */
export function BetChips({ amount, style, align }: { amount: number; style?: CSSProperties; align: string }) {
  return (
    <div
      className={`pt-bet pt-bet--${align}`}
      style={style}
      data-testid="bet"
      aria-label={`Einsatz ${formatChips(amount)}`}
    >
      <ChipSvg />
      <span className="pt-bet-amount">{formatChips(amount)}</span>
    </div>
  );
}

const MARKER_LABEL = { dealer: 'D', sb: 'SB', bb: 'BB' } as const;
const MARKER_NAME = { dealer: 'Dealer', sb: 'Small Blind', bb: 'Big Blind' } as const;

/** Dealer-Button („D“) bzw. Small-/Big-Blind-Marker. */
export function DealerButton({ kind, className }: { kind: 'dealer' | 'sb' | 'bb'; className?: string }) {
  return (
    <div
      className={['pt-marker', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={MARKER_NAME[kind]}
      data-testid="marker"
      data-marker={kind}
    >
      <MarkerDiscSvg label={MARKER_LABEL[kind]} variant={kind === 'dealer' ? 'dealer' : 'blind'} />
    </div>
  );
}

/** Gemeinschaftskarten; freie Plätze bleiben reserviert, damit das Layout nicht springt. */
export function Board({ cards, fourColor }: { cards: readonly CardValue[]; fourColor: boolean }) {
  return (
    <div className="pt-board" data-testid="board" aria-label="Board">
      {[0, 1, 2, 3, 4].map((i) => {
        const card = cards[i];
        return card === undefined ? (
          <div key={i} className="pt-card pt-card--board pt-card--slot" aria-hidden="true" />
        ) : (
          <Card key={i} card={card} size="board" fourColor={fourColor} />
        );
      })}
    </div>
  );
}

/** Main Pot und Side Pots. Gibt es nur einen Pot, heißt er einfach „Pot“. */
export function PotDisplay({ pots }: { pots: readonly PotView[] }) {
  if (pots.length === 0) {
    return <div className="pt-pots" data-testid="pots" />;
  }
  return (
    <div className="pt-pots" data-testid="pots">
      {pots.map((pot, i) => {
        const label = pots.length === 1 ? 'Pot' : i === 0 ? 'Main Pot' : `Side Pot ${String(i)}`;
        return (
          <div key={i} className={`pt-pot${i === 0 ? ' pt-pot--main' : ''}`} data-testid="pot">
            <ChipSvg />
            <span className="pt-pot-label">{label}</span>
            <span className="pt-pot-amount">{formatChips(pot.amount)}</span>
          </div>
        );
      })}
    </div>
  );
}
