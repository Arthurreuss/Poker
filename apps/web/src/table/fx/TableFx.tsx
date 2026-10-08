/**
 * Animationen am Tisch (WP-031): Austeilen, Board aufdecken, Einsätze, Check, Fold, Einsätze → Pot,
 * Pot → Gewinner. Wird als `overlay` in die Tischfläche von `PokerTable` gelegt und arbeitet nur über die
 * Web Animations API (`element.animate`) und kurzlebige „Geister“-Elemente in der eigenen Ebene – keine
 * `<style>`-Elemente, keine Inline-Styles im Markup (CSP `style-src 'self'`, D-014).
 *
 * Regeln: rein darstellend (die Ansicht steht sofort im neuen Zustand, Animationen laufen nur „hinein“),
 * nie Eingaben blockieren (`pointer-events: none`, keine `fill: forwards`), aus bei „Animationen“ aus und
 * bei `prefers-reduced-motion: reduce`.
 */
import { useLayoutEffect, useRef } from 'react';
import type { TableView } from '../types';
import { diffTableViews, type TableEvent } from './events';
import './fx.css';

export interface TableFxProps {
  readonly view: TableView;
  /** Einstellung „Animationen“ (WP-018); `prefers-reduced-motion` wird zusätzlich geprüft. */
  readonly enabled: boolean;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Snapshot {
  readonly center: Box | null;
  readonly pots: Box | null;
  readonly cards: ReadonlyMap<number, Box>;
  readonly plates: ReadonlyMap<number, Box>;
  readonly bets: ReadonlyMap<number, Box>;
}

const EASE_OUT = 'cubic-bezier(0.2, 0.7, 0.3, 1)';

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const mid = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const hasSize = (b: Box | null): b is Box => b !== null && b.w > 0 && b.h > 0;

function boxOf(el: Element | null, origin: DOMRect): Box | null {
  if (el === null) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

function measure(area: HTMLElement): Snapshot {
  const origin = area.getBoundingClientRect();
  const cards = new Map<number, Box>();
  const plates = new Map<number, Box>();
  const bets = new Map<number, Box>();
  for (const seat of area.querySelectorAll<HTMLElement>('[data-testid="seat"]')) {
    const n = Number(seat.dataset['seat']);
    const c = boxOf(seat.querySelector('[data-testid="hole-cards"]'), origin);
    const p = boxOf(seat.querySelector('[data-testid="seat-plate"]'), origin);
    if (c !== null) cards.set(n, c);
    if (p !== null) plates.set(n, p);
  }
  for (const bet of area.querySelectorAll<HTMLElement>('[data-testid="bet"][data-seat]')) {
    const b = boxOf(bet, origin);
    if (b !== null) bets.set(Number(bet.dataset['seat']), b);
  }
  return {
    center: boxOf(area.querySelector('[data-testid="board"]'), origin),
    pots: boxOf(area.querySelector('[data-testid="pots"]'), origin),
    cards,
    plates,
    bets,
  };
}

/** Animation auf einem echten Element; ohne Web Animations API (z. B. jsdom, alte Browser) nichts. */
function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
  if (typeof el.animate !== 'function') return;
  el.animate(keyframes, { fill: 'backwards', ...options });
}

/** Kurzlebiges Element in der Effekt-Ebene, das von `from` nach `to` fliegt und sich dann entfernt. */
function ghost(
  layer: HTMLElement,
  className: string,
  from: Box,
  to: { x: number; y: number },
  options: KeyframeAnimationOptions,
  end: Keyframe = {},
): void {
  const el = document.createElement('div');
  el.className = className;
  el.style.left = `${String(from.x)}px`;
  el.style.top = `${String(from.y)}px`;
  el.style.width = `${String(from.w)}px`;
  el.style.height = `${String(from.h)}px`;
  layer.appendChild(el);
  const start = mid(from);
  const dx = to.x - start.x;
  const dy = to.y - start.y;
  const remove = () => {
    el.remove();
  };
  if (typeof el.animate !== 'function') {
    remove();
    return;
  }
  const animation = el.animate(
    [
      { translate: '0px 0px', opacity: 1 },
      { translate: `${String(dx)}px ${String(dy)}px`, opacity: 1, ...end },
    ],
    { fill: 'both', ...options },
  );
  animation.onfinish = remove;
  animation.oncancel = remove;
  // Sicherheitsnetz: nie liegen bleiben (z. B. wenn der Tab im Hintergrund war).
  window.setTimeout(remove, Number(options.duration ?? 0) + (options.delay ?? 0) + 500);
}

function chipBox(at: { x: number; y: number }, size: number): Box {
  return { x: at.x - size / 2, y: at.y - size / 2, w: size, h: size };
}

function seatEl(area: HTMLElement, seat: number): HTMLElement | null {
  return area.querySelector<HTMLElement>(`[data-testid="seat"][data-seat="${String(seat)}"]`);
}

function run(events: readonly TableEvent[], area: HTMLElement, layer: HTMLElement, before: Snapshot, now: Snapshot) {
  const boardMid = hasSize(now.center) ? mid(now.center) : { x: area.clientWidth / 2, y: area.clientHeight / 2 };
  const potMid = hasSize(now.pots) ? mid(now.pots) : boardMid;
  const chipSize = Math.max(10, (now.center?.h ?? 60) * 0.28);
  let winDelay = 0;

  for (const event of events) {
    switch (event.type) {
      case 'deal': {
        const cards = event.seats.map((seat) =>
          Array.from(seatEl(area, seat)?.querySelectorAll('[data-testid="hole-cards"] .pt-card') ?? []),
        );
        const total = cards.reduce((n, c) => n + c.length, 0);
        const step = Math.min(70, 900 / Math.max(1, total));
        // Erst die erste Karte an alle, dann die zweite.
        cards.forEach((seatCards, i) => {
          seatCards.forEach((card, j) => {
            const r = card.getBoundingClientRect();
            const o = area.getBoundingClientRect();
            const dx = boardMid.x - (r.left - o.left + r.width / 2);
            const dy = boardMid.y - (r.top - o.top + r.height / 2);
            animate(
              card,
              [
                { translate: `${String(dx)}px ${String(dy)}px`, scale: '0.5', opacity: 0 },
                { translate: '0px 0px', scale: '1', opacity: 1 },
              ],
              { duration: 300, delay: (j * cards.length + i) * step, easing: EASE_OUT },
            );
          });
        });
        break;
      }
      case 'board': {
        const slots = area.querySelector('[data-testid="board"]')?.children ?? [];
        for (let i = event.from; i < event.to; i++) {
          const card = slots[i];
          if (card === undefined) continue;
          animate(
            card,
            [
              { scale: '0 1', opacity: 0.4 },
              { scale: '1 1', opacity: 1 },
            ],
            { duration: 280, delay: (i - event.from) * 120, easing: EASE_OUT },
          );
        }
        break;
      }
      case 'bet': {
        const bet = area.querySelector(`[data-testid="bet"][data-seat="${String(event.seat)}"]`);
        const plate = now.plates.get(event.seat);
        const target = now.bets.get(event.seat);
        if (bet === null || plate === undefined || target === undefined) break;
        const p = mid(plate);
        const t = mid(target);
        animate(
          bet,
          [
            { translate: `${String(p.x - t.x)}px ${String(p.y - t.y)}px`, opacity: 0 },
            { translate: '0px 0px', opacity: 1 },
          ],
          { duration: 260, easing: EASE_OUT },
        );
        break;
      }
      case 'check': {
        const plate = seatEl(area, event.seat)?.querySelector('[data-testid="seat-plate"]');
        if (plate) {
          animate(plate, [{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 220, fill: 'none' });
        }
        break;
      }
      case 'fold': {
        const from = before.cards.get(event.seat);
        if (from === undefined || !hasSize(from)) break;
        ghost(
          layer,
          'fx-cards',
          from,
          boardMid,
          { duration: 380, easing: 'ease-in' },
          {
            opacity: 0,
            scale: '0.5',
            rotate: '25deg',
          },
        );
        break;
      }
      case 'collect': {
        event.seats.forEach((seat, i) => {
          const from = before.bets.get(seat);
          if (from === undefined) return;
          const start = mid(from);
          ghost(layer, 'fx-chip', chipBox({ x: from.x + from.h / 2, y: start.y }, chipSize), potMid, {
            duration: 360,
            delay: i * 40,
            easing: 'ease-in-out',
          });
        });
        winDelay = 380;
        break;
      }
      case 'reveal': {
        for (const card of seatEl(area, event.seat)?.querySelectorAll('[data-testid="hole-cards"] .pt-card') ?? []) {
          animate(
            card,
            [
              { scale: '0 1', opacity: 0.4 },
              { scale: '1 1', opacity: 1 },
            ],
            { duration: 260, easing: EASE_OUT },
          );
        }
        break;
      }
      case 'win': {
        const origin = hasSize(before.pots) && before.pots.w > 0 ? mid(before.pots) : potMid;
        event.seats.forEach((seat, i) => {
          const plate = now.plates.get(seat);
          if (plate === undefined) return;
          for (let k = 0; k < 5; k++) {
            ghost(layer, 'fx-chip', chipBox(origin, chipSize), mid(plate), {
              duration: 520,
              delay: winDelay + i * 120 + k * 60,
              easing: 'ease-in-out',
            });
          }
          const plateEl = seatEl(area, seat)?.querySelector('[data-testid="seat-plate"]');
          if (plateEl) {
            animate(plateEl, [{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], {
              duration: 600,
              delay: winDelay + 400,
              iterations: 2,
              fill: 'none',
            });
          }
        });
        break;
      }
      case 'yourTurn':
        break;
    }
  }
}

/** Effekt-Ebene über der Tischfläche; misst nach jedem Stand die Positionen für den nächsten Übergang. */
export function TableFx({ view, enabled }: TableFxProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const prevView = useRef<TableView | null>(null);
  const prevBoxes = useRef<Snapshot | null>(null);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const area = layer?.parentElement ?? null;
    if (layer === null || area === null) return;
    const events = diffTableViews(prevView.current, view);
    prevView.current = view;
    const before = prevBoxes.current;
    const now = measure(area);
    prevBoxes.current = now;
    if (events.length === 0 || before === null || !enabled || prefersReducedMotion()) return;
    run(events, area, layer, before, now);
  }, [view, enabled]);

  return <div ref={layerRef} className="fx-layer" aria-hidden="true" data-testid="table-fx" />;
}
