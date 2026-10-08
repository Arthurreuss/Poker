import type { CSSProperties, ReactNode } from 'react';
import './table.css';
import './seat-extras.css';
import { Card } from './Card';
import { formatChips } from './format';
import { placeSeats, seatMarker, type PlacedSeat, type TableLayout } from './layout';
import { BetChips, Board, DealerButton, PotDisplay } from './parts';
import { RevealableCards, type CardReveal } from './RevealableCards';
import { SeatPlate } from './SeatPlate';
import type { TableView } from './types';

export interface PokerTableProps {
  readonly view: TableView;
  /** Vier-Farben-Deck (Karo blau, Kreuz grün). */
  readonly fourColor?: boolean;
  /** Inhalt des unteren Bereichs (Aktionsleiste, WP-018). Ohne Inhalt bleibt der Platz frei. */
  readonly actionBar?: ReactNode;
  /** Hoch- oder Querformat (D-009). Standard: Hochformat. */
  readonly layout?: TableLayout;
  /** Tisch-Menü oben links (z. B. `TableMenu`, WP-017). */
  readonly menu?: ReactNode;
  /** Reaktions-Knopf oben rechts (WP-032); ohne Inhalt bleibt die Ecke frei. */
  readonly reactionPicker?: ReactNode;
  /** Nur für Admins (WP-033, D-027): verdeckte Karten der Mitspieler per Tipp umdrehen. */
  readonly reveal?: CardReveal | undefined;
}

function at(x: number, y: number): CSSProperties {
  return { left: `${String(x)}%`, top: `${String(y)}%` };
}

function blindsText(view: TableView): string {
  const { small, big, level, ante } = view.blinds;
  const parts = [`Blinds ${formatChips(small)}/${formatChips(big)}`];
  if (ante !== undefined && ante > 0) parts.push(`Ante ${formatChips(ante)}`);
  if (level !== undefined) parts.unshift(`Level ${String(level)}`);
  return parts.join(' · ');
}

function SeatCards({ placed, fourColor, reveal }: { placed: PlacedSeat; fourColor: boolean; reveal?: CardReveal }) {
  const { holeCards } = placed.player;
  if (holeCards.kind === 'none') return null;
  if (holeCards.kind === 'hidden' && reveal !== undefined && !placed.isHero) {
    return <RevealableCards seat={placed.seat} name={placed.player.name} reveal={reveal} fourColor={fourColor} />;
  }
  const big = placed.isHero && holeCards.kind !== 'hidden';
  const size = big ? 'hero' : 'seat';
  const cards = holeCards.kind === 'hidden' ? [undefined, undefined] : [...holeCards.cards];
  const classes = ['pt-seat-cards', `pt-seat-cards--${holeCards.kind}`, big && 'pt-seat-cards--hero']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-testid="hole-cards" data-kind={holeCards.kind}>
      {cards.map((card, i) => (
        <Card key={i} card={card} size={size} fourColor={fourColor} />
      ))}
    </div>
  );
}

function TableSeat({
  placed,
  view,
  fourColor,
  reveal,
}: {
  placed: PlacedSeat;
  view: TableView;
  fourColor: boolean;
  reveal: CardReveal | undefined;
}) {
  const { slot, player, seat, isHero } = placed;
  const toAct = view.toActSeat === seat;
  const marker = seatMarker(view, seat);
  const reaction = view.reactions?.find((r) => r.seat === seat);
  return (
    <div
      className={`pt-seat${isHero ? ' pt-seat--hero' : ''} pt-seat--${player.status}`}
      style={at(slot.x, slot.y)}
      data-testid="seat"
      data-seat={seat}
      data-slot={slot.id}
      data-hero={isHero ? 'true' : undefined}
      data-status={player.status}
      data-to-act={toAct ? 'true' : undefined}
      data-connected={player.connected ? 'true' : 'false'}
    >
      <SeatCards placed={placed} fourColor={fourColor} {...(reveal === undefined ? {} : { reveal })} />
      <SeatPlate
        name={player.name}
        stack={player.stack}
        status={player.status}
        connected={player.connected}
        toAct={toAct}
        timeRemaining={toAct ? view.timeRemaining : undefined}
        timeBankSeconds={toAct ? view.timeBankSeconds : undefined}
        isHero={isHero}
        avatar={player.avatar}
        avatarSide={slot.markerSide === 'left' ? 'right' : 'left'}
      />
      {reaction !== undefined && (
        <span
          key={reaction.id}
          className="pt-reaction"
          role="img"
          aria-label={`${player.name}: ${reaction.label}`}
          data-testid="reaction"
        >
          {reaction.emoji}
        </span>
      )}
      {marker !== null && (
        <DealerButton kind={marker} className={`pt-seat-marker pt-seat-marker--${slot.markerSide}`} />
      )}
    </div>
  );
}

/**
 * Tischansicht (WP-016 Hochformat, WP-017 Querformat): reine Funktion des gefilterten
 * Tischzustands. Eigener Sitz unten mittig, übrige Sitze im Uhrzeigersinn; skaliert mit der
 * Containergröße. Beide Layouts haben denselben Elementbaum – ein Wechsel ändert nur Klassen und
 * Positionen, nichts wird neu gemountet (Aktionsleiste und Menü behalten ihren Zustand).
 */
export function PokerTable({
  view,
  fourColor = false,
  actionBar,
  layout = 'portrait',
  menu,
  reactionPicker,
  reveal,
}: PokerTableProps) {
  const placed = placeSeats(view, layout);
  return (
    <div className="pt-host">
      <div className={`pt-root pt-root--${layout}`} data-testid="poker-table" data-layout={layout}>
        <div className="pt-info" data-testid="blinds">
          <span className="pt-text">{blindsText(view)}</span>
        </div>
        <div className="pt-area" data-testid="table-area">
          <div className="pt-felt" aria-hidden="true" />
          <div className="pt-center">
            <PotDisplay pots={view.pots} />
            <Board cards={view.board} fourColor={fourColor} />
          </div>
          {placed.map((p) => (
            <TableSeat key={p.seat} placed={p} view={view} fourColor={fourColor} reveal={reveal} />
          ))}
          {placed
            .filter((p) => p.player.bet > 0)
            .map((p) => (
              <BetChips
                key={p.seat}
                amount={p.player.bet}
                align={p.slot.betAlign}
                style={at(p.slot.betX, p.slot.betY)}
              />
            ))}
        </div>
        <div className="pt-action-slot" data-testid="action-slot">
          {actionBar}
        </div>
        <div className="pt-menu-slot" data-testid="menu-slot">
          {menu}
        </div>
        {reactionPicker !== undefined && reactionPicker !== null && (
          <div className="pt-react-slot" data-testid="react-slot">
            {reactionPicker}
          </div>
        )}
      </div>
    </div>
  );
}
