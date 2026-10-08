/**
 * Avatar-Grafiken (WP-032): selbst gezeichnete, schlichte SVG-Motive im Raster 0–64 auf farbigem Kreis
 * (D-008: keine fremden Assets). Nur SVG-Attribute, keine Inline-Styles (CSP). Herkunft: src/avatars/ASSETS.md.
 * Die IDs stammen aus `AVATAR_IDS` (@poker/engine/protocol); jede ID braucht hier ein Motiv.
 */
import type { AvatarId } from '@poker/engine/protocol';
import type { ReactElement } from 'react';

export interface AvatarArt {
  /** Deutscher Name (Barrierefreiheit, Auswahl). */
  readonly label: string;
  /** Hintergrundfarbe des Kreises. */
  readonly bg: string;
  readonly draw: () => ReactElement;
}

const INK = '#1d232b';
const WHITE = '#f7f5ef';

/** Zwei Augen mit Glanzpunkt. */
function eyes(y: number, dx: number, r = 3, x = 32) {
  return (
    <>
      <circle cx={x - dx} cy={y} r={r} fill={INK} />
      <circle cx={x + dx} cy={y} r={r} fill={INK} />
      <circle cx={x - dx + r / 3} cy={y - r / 3} r={r / 3} fill={WHITE} />
      <circle cx={x + dx + r / 3} cy={y - r / 3} r={r / 3} fill={WHITE} />
    </>
  );
}

const STAR_PATH = (cx: number, cy: number, outer: number, inner: number): string => {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${points.join(' L')} Z`;
};

export const AVATAR_ART: Readonly<Record<AvatarId, AvatarArt>> = {
  fox: {
    label: 'Fuchs',
    bg: '#2f6f8f',
    draw: () => (
      <>
        <path d="M12 12 L26 22 L18 32 Z" fill="#e5782a" />
        <path d="M52 12 L38 22 L46 32 Z" fill="#e5782a" />
        <path d="M15 16 L22 23 L18 28 Z" fill={INK} />
        <path d="M49 16 L42 23 L46 28 Z" fill={INK} />
        <path d="M14 26 C14 18 22 16 32 16 C42 16 50 18 50 26 C50 36 40 48 32 54 C24 48 14 36 14 26 Z" fill="#e5782a" />
        <path d="M14 30 C20 34 26 36 32 54 C24 48 16 40 14 30 Z" fill={WHITE} />
        <path d="M50 30 C44 34 38 36 32 54 C40 48 48 40 50 30 Z" fill={WHITE} />
        {eyes(30, 8, 2.6)}
        <ellipse cx="32" cy="48" rx="3.4" ry="2.6" fill={INK} />
      </>
    ),
  },
  cat: {
    label: 'Katze',
    bg: '#c9734a',
    draw: () => (
      <>
        <path d="M13 14 L28 22 L15 34 Z" fill="#8a8f98" />
        <path d="M51 14 L36 22 L49 34 Z" fill="#8a8f98" />
        <path d="M16 19 L24 23 L17 29 Z" fill="#e7a1a8" />
        <path d="M48 19 L40 23 L47 29 Z" fill="#e7a1a8" />
        <ellipse cx="32" cy="36" rx="19" ry="17" fill="#8a8f98" />
        <ellipse cx="25" cy="33" rx="3" ry="4" fill="#a7d36b" />
        <ellipse cx="39" cy="33" rx="3" ry="4" fill="#a7d36b" />
        <ellipse cx="25" cy="33" rx="1.2" ry="3.4" fill={INK} />
        <ellipse cx="39" cy="33" rx="1.2" ry="3.4" fill={INK} />
        <path d="M29.5 40 L34.5 40 L32 43 Z" fill="#e7a1a8" />
        <path d="M32 43 C31 46 28 46 27 45 M32 43 C33 46 36 46 37 45" stroke={INK} strokeWidth="1.4" fill="none" />
        <path
          d="M10 38 L22 40 M10 44 L22 42 M54 38 L42 40 M54 44 L42 42"
          stroke={WHITE}
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </>
    ),
  },
  owl: {
    label: 'Eule',
    bg: '#3b4f7a',
    draw: () => (
      <>
        <path d="M14 14 L24 20 L16 26 Z" fill="#8b5e3c" />
        <path d="M50 14 L40 20 L48 26 Z" fill="#8b5e3c" />
        <ellipse cx="32" cy="38" rx="19" ry="20" fill="#8b5e3c" />
        <ellipse cx="32" cy="46" rx="11" ry="10" fill="#d9b48a" />
        <circle cx="24" cy="31" r="8" fill={WHITE} />
        <circle cx="40" cy="31" r="8" fill={WHITE} />
        <circle cx="24" cy="31" r="4" fill={INK} />
        <circle cx="40" cy="31" r="4" fill={INK} />
        <circle cx="25.3" cy="29.7" r="1.3" fill={WHITE} />
        <circle cx="41.3" cy="29.7" r="1.3" fill={WHITE} />
        <path d="M29 37 L35 37 L32 43 Z" fill="#e9a23b" />
        <path
          d="M26 48 l2 2 l2 -2 M34 48 l2 2 l2 -2 M30 53 l2 2 l2 -2"
          stroke="#8b5e3c"
          strokeWidth="1.4"
          fill="none"
        />
      </>
    ),
  },
  bear: {
    label: 'Bär',
    bg: '#6c8f4e',
    draw: () => (
      <>
        <circle cx="17" cy="19" r="7" fill="#7a4e2d" />
        <circle cx="47" cy="19" r="7" fill="#7a4e2d" />
        <circle cx="17" cy="19" r="3.5" fill="#b9825a" />
        <circle cx="47" cy="19" r="3.5" fill="#b9825a" />
        <circle cx="32" cy="35" r="19" fill="#7a4e2d" />
        <ellipse cx="32" cy="42" rx="9" ry="7" fill="#c9976c" />
        {eyes(31, 8, 2.6)}
        <ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill={INK} />
        <path d="M32 41.5 L32 45 M28.5 46 C30 47.5 34 47.5 35.5 46" stroke={INK} strokeWidth="1.4" fill="none" />
      </>
    ),
  },
  rabbit: {
    label: 'Hase',
    bg: '#7b5aa6',
    draw: () => (
      <>
        <ellipse cx="24" cy="15" rx="5.5" ry="13" fill={WHITE} transform="rotate(-10 24 15)" />
        <ellipse cx="40" cy="15" rx="5.5" ry="13" fill={WHITE} transform="rotate(10 40 15)" />
        <ellipse cx="24" cy="15" rx="2.6" ry="9.5" fill="#e7a1a8" transform="rotate(-10 24 15)" />
        <ellipse cx="40" cy="15" rx="2.6" ry="9.5" fill="#e7a1a8" transform="rotate(10 40 15)" />
        <ellipse cx="32" cy="39" rx="17" ry="16" fill={WHITE} />
        {eyes(36, 7, 2.6)}
        <path d="M29.5 42 L34.5 42 L32 45 Z" fill="#e07a8a" />
        <path
          d="M32 45 C31 48 28.5 48 27.5 46.5 M32 45 C33 48 35.5 48 36.5 46.5"
          stroke={INK}
          strokeWidth="1.3"
          fill="none"
        />
        <circle cx="21" cy="44" r="3" fill="#f2c7cc" />
        <circle cx="43" cy="44" r="3" fill="#f2c7cc" />
      </>
    ),
  },
  frog: {
    label: 'Frosch',
    bg: '#2c6b8e',
    draw: () => (
      <>
        <circle cx="21" cy="22" r="8" fill="#5fae4a" />
        <circle cx="43" cy="22" r="8" fill="#5fae4a" />
        <ellipse cx="32" cy="38" rx="22" ry="16" fill="#5fae4a" />
        <circle cx="21" cy="22" r="5" fill={WHITE} />
        <circle cx="43" cy="22" r="5" fill={WHITE} />
        <circle cx="21" cy="23" r="2.6" fill={INK} />
        <circle cx="43" cy="23" r="2.6" fill={INK} />
        <path d="M18 40 C24 47 40 47 46 40" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="29" cy="33" r="1" fill={INK} />
        <circle cx="35" cy="33" r="1" fill={INK} />
        <circle cx="16" cy="39" r="3" fill="#e98f8f" opacity="0.7" />
        <circle cx="48" cy="39" r="3" fill="#e98f8f" opacity="0.7" />
      </>
    ),
  },
  panda: {
    label: 'Panda',
    bg: '#5e9a6e',
    draw: () => (
      <>
        <circle cx="17" cy="18" r="7" fill={INK} />
        <circle cx="47" cy="18" r="7" fill={INK} />
        <circle cx="32" cy="35" r="19" fill={WHITE} />
        <ellipse cx="24" cy="33" rx="5" ry="6.5" fill={INK} transform="rotate(-25 24 33)" />
        <ellipse cx="40" cy="33" rx="5" ry="6.5" fill={INK} transform="rotate(25 40 33)" />
        <circle cx="24.5" cy="32.5" r="1.8" fill={WHITE} />
        <circle cx="39.5" cy="32.5" r="1.8" fill={WHITE} />
        <ellipse cx="32" cy="41" rx="3.4" ry="2.4" fill={INK} />
        <path d="M28.5 45 C30 46.5 34 46.5 35.5 45" stroke={INK} strokeWidth="1.4" fill="none" />
      </>
    ),
  },
  penguin: {
    label: 'Pinguin',
    bg: '#4f86c6',
    draw: () => (
      <>
        <ellipse cx="32" cy="34" rx="19" ry="21" fill={INK} />
        <path d="M32 24 C40 18 48 24 46 34 C45 44 40 52 32 52 C24 52 19 44 18 34 C16 24 24 18 32 24 Z" fill={WHITE} />
        {eyes(31, 7, 2.6)}
        <path d="M27 37 L37 37 L32 43 Z" fill="#f0a23a" />
      </>
    ),
  },
  lion: {
    label: 'Löwe',
    bg: '#3f7d7a',
    draw: () => (
      <>
        <circle cx="32" cy="33" r="24" fill="#b5652a" />
        <path
          d="M32 9 L36 14 L42 10 L43 17 L50 15 L48 22 L55 23 L50 29 L56 33 L50 37 L55 43 L48 44 L50 51 L43 49 L42 56 L36 52 L32 57 L28 52 L22 56 L21 49 L14 51 L16 44 L9 43 L14 37 L8 33 L14 29 L9 23 L16 22 L14 15 L21 17 L22 10 L28 14 Z"
          fill="#b5652a"
        />
        <circle cx="32" cy="34" r="15" fill="#e8b04b" />
        {eyes(31, 6, 2.4)}
        <path d="M29 38 L35 38 L32 41.5 Z" fill="#6b3b1f" />
        <path d="M32 41.5 L32 43 M29 45 C30.5 46 33.5 46 35 45" stroke="#6b3b1f" strokeWidth="1.4" fill="none" />
      </>
    ),
  },
  pig: {
    label: 'Schwein',
    bg: '#4b7bb5',
    draw: () => (
      <>
        <path d="M14 14 L26 20 L17 28 Z" fill="#e8909c" />
        <path d="M50 14 L38 20 L47 28 Z" fill="#e8909c" />
        <circle cx="32" cy="35" r="19" fill="#f2aab4" />
        {eyes(30, 8, 2.4)}
        <ellipse cx="32" cy="40" rx="8" ry="6" fill="#e8909c" />
        <ellipse cx="29" cy="40" rx="1.6" ry="2.4" fill="#9c4b58" />
        <ellipse cx="35" cy="40" rx="1.6" ry="2.4" fill="#9c4b58" />
        <path d="M27 49 C30 50.5 34 50.5 37 49" stroke="#9c4b58" strokeWidth="1.4" fill="none" />
      </>
    ),
  },
  mouse: {
    label: 'Maus',
    bg: '#d39b3a',
    draw: () => (
      <>
        <circle cx="16" cy="20" r="10" fill="#9aa1ab" />
        <circle cx="48" cy="20" r="10" fill="#9aa1ab" />
        <circle cx="16" cy="20" r="6" fill="#e7a1a8" />
        <circle cx="48" cy="20" r="6" fill="#e7a1a8" />
        <ellipse cx="32" cy="38" rx="15" ry="16" fill="#9aa1ab" />
        {eyes(35, 6, 2.4)}
        <circle cx="32" cy="44" r="2.6" fill="#e07a8a" />
        <path
          d="M14 42 L25 44 M14 48 L25 46 M50 42 L39 44 M50 48 L39 46"
          stroke={INK}
          strokeWidth="1"
          strokeLinecap="round"
        />
      </>
    ),
  },
  dog: {
    label: 'Hund',
    bg: '#a8504a',
    draw: () => (
      <>
        <circle cx="32" cy="34" r="18" fill="#d4a46a" />
        <path d="M15 20 C9 22 8 34 12 42 C16 40 18 32 19 24 Z" fill="#6b4a2f" />
        <path d="M49 20 C55 22 56 34 52 42 C48 40 46 32 45 24 Z" fill="#6b4a2f" />
        <ellipse cx="32" cy="42" rx="9" ry="7" fill="#f0d6ae" />
        <ellipse cx="25" cy="30" rx="4.5" ry="4" fill="#6b4a2f" />
        {eyes(31, 7, 2.4)}
        <ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill={INK} />
        <path d="M32 41.5 L32 44 M28.5 45 C30 46.5 34 46.5 35.5 45" stroke={INK} strokeWidth="1.4" fill="none" />
        <path d="M30 46 C30 50 34 50 34 46 Z" fill="#e07a8a" />
      </>
    ),
  },
  chip: {
    label: 'Chip',
    bg: '#1e6b47',
    draw: () => (
      <>
        <circle cx="32" cy="32" r="21" fill="#c8423b" />
        <path
          d="M32 11 L32 18 M32 46 L32 53 M11 32 L18 32 M46 32 L53 32 M17.2 17.2 L22.1 22.1 M41.9 41.9 L46.8 46.8 M46.8 17.2 L41.9 22.1 M22.1 41.9 L17.2 46.8"
          stroke={WHITE}
          strokeWidth="5"
        />
        <circle cx="32" cy="32" r="13" fill="#c8423b" stroke={WHITE} strokeWidth="1.6" strokeDasharray="3 2" />
        <circle cx="32" cy="32" r="8" fill={WHITE} />
        <circle cx="32" cy="32" r="4" fill="#c8423b" />
      </>
    ),
  },
  spade: {
    label: 'Pik',
    bg: '#d8d2c0',
    draw: () => (
      <path
        d="M32 12 C40 23 51 31 51 41 C51 48 46 52 40 52 C36 52 33.5 50 32 47 C32.5 51 34 54 37 56 L27 56 C30 54 31.5 51 32 47 C30.5 50 28 52 24 52 C18 52 13 48 13 41 C13 31 24 23 32 12 Z"
        fill={INK}
      />
    ),
  },
  heart: {
    label: 'Herz',
    bg: '#d8d2c0',
    draw: () => (
      <path
        d="M32 53 C18 42 11 34 11 24 C11 17 16 12 22.5 12 C27 12 30 15 32 19 C34 15 37 12 41.5 12 C48 12 53 17 53 24 C53 34 46 42 32 53 Z"
        fill="#c8202f"
      />
    ),
  },
  diamond: {
    label: 'Karo',
    bg: '#d8d2c0',
    draw: () => <path d="M32 10 L50 32 L32 54 L14 32 Z" fill="#c8202f" />,
  },
  club: {
    label: 'Kreuz',
    bg: '#d8d2c0',
    draw: () => (
      <g fill={INK}>
        <circle cx="32" cy="22" r="9" />
        <circle cx="22" cy="36" r="9" />
        <circle cx="42" cy="36" r="9" />
        <circle cx="32" cy="33" r="6" />
        <path d="M30 36 C30 46 28 51 24 55 L40 55 C36 51 34 46 34 36 Z" />
      </g>
    ),
  },
  crown: {
    label: 'Krone',
    bg: '#6b3f8f',
    draw: () => (
      <>
        <path d="M12 24 L22 34 L32 16 L42 34 L52 24 L48 46 L16 46 Z" fill="#e2b244" />
        <rect x="16" y="46" width="32" height="6" rx="1.5" fill="#c9952c" />
        <circle cx="12" cy="24" r="3" fill="#e2b244" />
        <circle cx="32" cy="16" r="3" fill="#e2b244" />
        <circle cx="52" cy="24" r="3" fill="#e2b244" />
        <circle cx="32" cy="37" r="3.4" fill="#c8202f" />
        <circle cx="22" cy="40" r="2.4" fill="#1f5fc4" />
        <circle cx="42" cy="40" r="2.4" fill="#18803c" />
      </>
    ),
  },
  star: {
    label: 'Stern',
    bg: '#2b3f73',
    draw: () => (
      <>
        <path d={STAR_PATH(32, 34, 22, 9.5)} fill="#f2c94c" />
        <circle cx="27" cy="34" r="1.8" fill={INK} />
        <circle cx="37" cy="34" r="1.8" fill={INK} />
        <path d="M28.5 39 C30.5 41 33.5 41 35.5 39" stroke={INK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  moon: {
    label: 'Mond',
    bg: '#1f2a4a',
    draw: () => (
      <>
        <path
          d="M38 12 C26 13 17 22 17 34 C17 46 27 55 39 55 C44 55 48 53 51 50 C36 50 27 40 27 29 C27 21 31 15 38 12 Z"
          fill="#f1e3a6"
        />
        <path d={STAR_PATH(45, 22, 5, 2.2)} fill="#f1e3a6" />
        <path d={STAR_PATH(51, 36, 3, 1.3)} fill="#f1e3a6" />
        <circle cx="24" cy="38" r="1.6" fill="#c9b770" />
        <circle cx="30" cy="47" r="2.2" fill="#c9b770" />
      </>
    ),
  },
  rocket: {
    label: 'Rakete',
    bg: '#22314f',
    draw: () => (
      <>
        <path d="M27 46 L32 58 L37 46 Z" fill="#f0a23a" />
        <path d="M29 46 L32 53 L35 46 Z" fill="#f2d24c" />
        <path d="M24 34 L16 46 L25 44 Z" fill="#c8423b" />
        <path d="M40 34 L48 46 L39 44 Z" fill="#c8423b" />
        <path d="M32 8 C40 14 42 26 40 46 L24 46 C22 26 24 14 32 8 Z" fill={WHITE} />
        <path d="M32 8 C36 11 38.5 15 39.5 20 L24.5 20 C25.5 15 28 11 32 8 Z" fill="#c8423b" />
        <circle cx="32" cy="29" r="5" fill="#4f86c6" stroke="#9aa1ab" strokeWidth="2" />
        <rect x="30" y="38" width="4" height="8" fill="#c8423b" />
      </>
    ),
  },
  ghost: {
    label: 'Geist',
    bg: '#5b4a8a',
    draw: () => (
      <>
        <path
          d="M15 54 L15 30 C15 18 22 11 32 11 C42 11 49 18 49 30 L49 54 L43.5 49 L38 54 L32 49 L26 54 L20.5 49 Z"
          fill={WHITE}
        />
        <ellipse cx="26" cy="29" rx="3" ry="4.2" fill={INK} />
        <ellipse cx="38" cy="29" rx="3" ry="4.2" fill={INK} />
        <ellipse cx="32" cy="39" rx="3.2" ry="4" fill={INK} />
      </>
    ),
  },
  robot: {
    label: 'Roboter',
    bg: '#c46a2f',
    draw: () => (
      <>
        <path d="M32 8 L32 16" stroke="#9aa1ab" strokeWidth="2.4" />
        <circle cx="32" cy="8" r="3" fill="#c8202f" />
        <rect x="9" y="27" width="5" height="12" rx="2" fill="#7c8590" />
        <rect x="50" y="27" width="5" height="12" rx="2" fill="#7c8590" />
        <rect x="13" y="16" width="38" height="34" rx="7" fill="#b8c0c9" />
        <rect x="18" y="23" width="28" height="13" rx="4" fill="#26303b" />
        <circle cx="25" cy="29.5" r="3.2" fill="#5ee0d6" />
        <circle cx="39" cy="29.5" r="3.2" fill="#5ee0d6" />
        <rect x="21" y="40" width="22" height="5" rx="1.5" fill="#26303b" />
        <path d="M26.5 40 L26.5 45 M32 40 L32 45 M37.5 40 L37.5 45" stroke="#b8c0c9" strokeWidth="1.4" />
      </>
    ),
  },
  cactus: {
    label: 'Kaktus',
    bg: '#e0b45c',
    draw: () => (
      <>
        <path d="M18 46 L46 46 L43 57 L21 57 Z" fill="#b5652a" />
        <rect x="16" y="43" width="32" height="5" rx="1.5" fill="#c97a3c" />
        <rect x="26" y="12" width="12" height="32" rx="6" fill="#4f9a4a" />
        <path d="M26 32 L20 32 C17 32 16 30 16 27 L16 21 C16 19 20 19 20 21 L20 27 L26 27 Z" fill="#4f9a4a" />
        <path d="M38 28 L44 28 C47 28 48 26 48 23 L48 17 C48 15 44 15 44 17 L44 23 L38 23 Z" fill="#4f9a4a" />
        <path d="M32 16 L32 40" stroke="#3c7a38" strokeWidth="1.4" />
        <circle cx="32" cy="12" r="3" fill="#e86a8a" />
        <circle cx="29" cy="25" r="1" fill={INK} />
        <circle cx="35" cy="25" r="1" fill={INK} />
        <path d="M29.5 29 C31 30.5 33 30.5 34.5 29" stroke={INK} strokeWidth="1.1" fill="none" />
      </>
    ),
  },
};
