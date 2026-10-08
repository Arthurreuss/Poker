/**
 * Farbsymbole (Kreuz, Karo, Herz, Pik) – selbst gezeichnete Pfade im Raster 0–100 (D-008).
 * Herkunft: apps/web/src/table/ASSETS.md.
 */
import type { Suit } from '@poker/engine';

const HEART =
  'M50 92 C22 70 4 52 4 31 C4 14 16 4 30 4 C40 4 46 10 50 19 C54 10 60 4 70 4 C84 4 96 14 96 31 C96 52 78 70 50 92 Z';
const DIAMOND = 'M50 2 L90 50 L50 98 L10 50 Z';
const SPADE =
  'M50 3 C64 22 96 40 96 61 C96 75 86 83 74 83 C65 83 58 79 54 72 C55 82 59 90 67 97 L33 97 C41 90 45 82 46 72 C42 79 35 83 26 83 C14 83 4 75 4 61 C4 40 36 22 50 3 Z';
const CLUB_STEM = 'M46 58 C46 78 41 89 32 97 L68 97 C59 89 54 78 54 58 Z';

/** Symbol einer Farbe als SVG-Gruppe im Raster 0–100; Füllfarbe per CSS-Klasse. */
export function SuitShape({ suit, className }: { suit: Suit; className?: string }) {
  switch (suit) {
    case 'h':
      return <path d={HEART} className={className} />;
    case 'd':
      return <path d={DIAMOND} className={className} />;
    case 's':
      return <path d={SPADE} className={className} />;
    case 'c':
      return (
        <g className={className}>
          <circle cx="50" cy="26" r="21" />
          <circle cx="25" cy="58" r="21" />
          <circle cx="75" cy="58" r="21" />
          <circle cx="50" cy="52" r="12" />
          <path d={CLUB_STEM} />
        </g>
      );
  }
}
