import type { CSSProperties, ReactNode } from 'react';
import './table.css';
import './seat-extras.css';
import './fx/fx.css';
import { Card, winHighlight } from './Card';
import { formatChips } from './format';
import { placeSeats, seatMarker, type PlacedSeat, type TableLayout } from './layout';
import { BetChips, Board, DealerButton, PotDisplay } from './parts';
import { SeatPlate } from './SeatPlate';
import type { Card as CardValue, TableView } from './types';

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
  /** Ebene über der Tischfläche, z. B. Animationen (`TableFx`, WP-031); nimmt keine Eingaben an. */
  readonly overlay?: ReactNode;
  /** Reaktions-Knopf oben rechts (WP-032); ohne Inhalt bleibt die Ecke frei. */
  readonly reactionPicker?: ReactNode;
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

function SeatCards({
  placed,
  fourColor,
  winning,
}: {
  placed: PlacedSeat;
  fourColor: boolean;
  winning: readonly CardValue[] | undefined;
}) {
  const { holeCards } = placed.player;
  if (holeCards.kind === 'none') return null;
  const big = placed.isHero && holeCards.kind !== 'hidden';
  const size = big ? 'hero' : 'seat';
  const cards = holeCards.kind === 'hidden' ? [undefined, undefined] : [...holeCards.cards];
  const classes = ['pt-seat-cards', `pt-seat-cards--${holeCards.kind}`, big && 'pt-seat-cards--hero']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} data-testid="hole-cards" data-kind={holeCards.kind}>
      {cards.map((card, i) => (
        <Card key={i} card={card} size={size} fourColor={fourColor} highlight={winHighlight(card, winning)} />
      ))}
    </div>
  );
}

function TableSeat({ placed, view, fourColor }: { placed: PlacedSeat; view: TableView; fourColor: boolean }) {
  const { slot, player, seat, isHero } = placed;
  const toAct = view.toActSeat === seat;
  const marker = seatMarker(view, seat);
  const winner = view.winnerSeats?.includes(seat) ?? false;
  const reaction = view.reactions?.find((r) => r.seat === seat);
  return (
    <div
      className={`pt-seat${isHero ? ' pt-seat--hero' : ''} pt-seat--${player.status}${winner ? ' pt-seat--winner' : ''}`}
      style={at(slot.x, slot.y)}
      data-testid="seat"
      data-seat={seat}
      data-slot={slot.id}
      data-hero={isHero ? 'true' : undefined}
      data-status={player.status}
      data-to-act={toAct ? 'true' : undefined}
      data-connected={player.connected ? 'true' : 'false'}
      data-winner={winner ? 'true' : undefined}
    >
      <SeatCards placed={placed} fourColor={fourColor} winning={view.winningCards} />
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
  overlay,
  reactionPicker,
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
            <Board cards={view.board} fourColor={fourColor} winning={view.winningCards} />
          </div>
          {placed.map((p) => (
            <TableSeat key={p.seat} placed={p} view={view} fourColor={fourColor} />
          ))}
          {placed
            .filter((p) => p.player.bet > 0)
            .map((p) => (
              <BetChips
                key={p.seat}
                seat={p.seat}
                amount={p.player.bet}
                align={p.slot.betAlign}
                style={at(p.slot.betX, p.slot.betY)}
              />
            ))}
          {overlay}
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
