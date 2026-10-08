// Erzeugt das Vorschaubild für Link-Vorschauen in Messengern (WP-030, Open Graph, 1200×630) aus einem eigenen,
// hier definierten SVG – keine fremden Assets (D-008). Aufruf: npm run og-image -w @poker/web.
// Das Ergebnis liegt eingecheckt in public/og-image.png, der Prod-Build braucht dieses Skript nicht.
// Farben = Tokens aus src/styles/tokens.css, Pik-Symbol wie in scripts/generate-icons.mjs.
// Text wird mit den Systemschriften gerendert (Helvetica/Arial); andere Rechner ergeben leicht andere Pixel.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function token(name) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (match === null) throw new Error(`Token --${name} nicht gefunden`);
  return match[1];
}

const c = {
  bg: token('color-bg'),
  surface: token('color-surface'),
  felt: token('color-felt'),
  edge: token('color-felt-edge'),
  accent: token('color-accent'),
  text: token('color-text'),
  muted: token('color-text-muted'),
  face: token('color-card-face'),
  red: token('color-card-red'),
  black: token('color-card-black'),
  fold: token('color-fold'),
  call: token('color-call'),
  raise: token('color-raise'),
};

// Pik und Herz in Viewbox 512 (Pik identisch mit dem App-Icon).
const spade =
  'M256 112C256 112 136 214 136 290c0 46 36 78 74 78 22 0 38-9 46-22 8 13 24 22 46 22 38 0 74-32 74-78C376 214 256 112 256 112Z' +
  'M256 318l-34 92h68Z';
const heart =
  'M256 400C256 400 112 300 112 206c0-50 38-86 82-86 30 0 50 16 62 38 12-22 32-38 62-38 44 0 82 36 82 86 0 94-144 194-144 194Z';

const font = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Spielkarte mit Rang oben links und großem Symbol, gedreht um die Kartenmitte. */
function card({ x, y, rank, suit, color, rotate }) {
  const w = 150;
  const h = 210;
  return `<g transform="rotate(${rotate} ${x + w / 2} ${y + h / 2})">
    <rect x="${x + 4}" y="${y + 8}" width="${w}" height="${h}" rx="14" fill="#000" opacity="0.35"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${c.face}"/>
    <text x="${x + 16}" y="${y + 50}" font-family="${font}" font-size="44" font-weight="700" fill="${color}">${rank}</text>
    <path d="${suit}" fill="${color}" transform="translate(${x + 14} ${y + 56}) scale(0.085)"/>
    <path d="${suit}" fill="${color}" transform="translate(${x + 31} ${y + 62}) scale(0.24)"/>
  </g>`;
}

/** Chip-Stapel aus n Chips. */
function chips({ x, y, n, color }) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const cy = y - i * 9;
    out += `<ellipse cx="${x}" cy="${cy + 4}" rx="34" ry="13" fill="#000" opacity="0.25"/>
    <ellipse cx="${x}" cy="${cy}" rx="34" ry="13" fill="${color}"/>
    <ellipse cx="${x}" cy="${cy}" rx="22" ry="8" fill="none" stroke="${c.face}" stroke-width="3" stroke-dasharray="6 6" opacity="0.8"/>`;
  }
  return out;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="0.72" cy="0.5" r="0.7">
      <stop offset="0" stop-color="${c.surface}"/>
      <stop offset="1" stop-color="${c.bg}"/>
    </radialGradient>
    <radialGradient id="felt" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0" stop-color="${c.felt}"/>
      <stop offset="1" stop-color="#174f36"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Tisch rechts, angeschnitten -->
  <ellipse cx="930" cy="330" rx="420" ry="270" fill="${c.edge}"/>
  <ellipse cx="930" cy="330" rx="392" ry="244" fill="url(#felt)"/>
  <ellipse cx="930" cy="330" rx="330" ry="190" fill="none" stroke="${c.face}" stroke-width="2" opacity="0.12"/>
  ${chips({ x: 735, y: 470, n: 4, color: c.fold })}
  ${chips({ x: 810, y: 495, n: 6, color: c.accent })}
  ${chips({ x: 1120, y: 470, n: 3, color: c.call })}
  ${card({ x: 790, y: 170, rank: 'A', suit: spade, color: c.black, rotate: -10 })}
  ${card({ x: 935, y: 165, rank: 'K', suit: heart, color: c.red, rotate: 8 })}

  <!-- Logo und Text links -->
  <g transform="translate(80 92)">
    <circle cx="64" cy="64" r="64" fill="${c.edge}"/>
    <circle cx="64" cy="64" r="58" fill="${c.felt}"/>
    <path d="${spade}" fill="${c.accent}" transform="translate(0 0) scale(0.25)"/>
  </g>
  <text x="80" y="330" font-family="${font}" font-size="112" font-weight="800" fill="${c.text}" letter-spacing="-2">Poker</text>
  <text x="84" y="398" font-family="${font}" font-size="46" font-weight="600" fill="${c.accent}">Spiel mit Freunden</text>
  <text x="84" y="458" font-family="${font}" font-size="30" fill="${c.muted}">Texas Hold’em · nur Spielgeld</text>
  <rect x="84" y="508" width="300" height="64" rx="32" fill="${c.call}"/>
  <text x="234" y="550" text-anchor="middle" font-family="${font}" font-size="28" font-weight="700" fill="${c.text}">Komm an den Tisch</text>
</svg>
`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Helvetica' },
})
  .render()
  .asPng();
writeFileSync(new URL('../public/og-image.png', import.meta.url), png);
console.log(`public/og-image.png (${String(Math.round(png.length / 1024))} KB)`);
