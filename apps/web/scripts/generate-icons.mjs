// Erzeugt die App-Icons (WP-014) aus eigenen, hier definierten SVGs – keine fremden Assets (D-008).
// Aufruf: npm run icons -w @poker/web. Die Ergebnisse liegen eingecheckt in public/icons/,
// der Prod-Build braucht dieses Skript nicht. Farben = Tokens aus src/styles/tokens.css.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const outDir = new URL('../public/icons/', import.meta.url);
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function token(name) {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens);
  if (match === null) throw new Error(`Token --${name} nicht gefunden`);
  return match[1];
}

const bg = token('color-bg');
const felt = token('color-felt');
const edge = token('color-felt-edge');
const accent = token('color-accent');

// Pik-Symbol, selbst gezeichnet (Viewbox 512). Liegt innerhalb der Maskable-Safe-Zone (Radius 40 %).
const spade =
  'M256 112C256 112 136 214 136 290c0 46 36 78 74 78 22 0 38-9 46-22 8 13 24 22 46 22 38 0 74-32 74-78C376 214 256 112 256 112Z' +
  'M256 318l-34 92h68Z';

function iconSvg({ rounded }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${bg}"/>
  <circle cx="256" cy="256" r="200" fill="${edge}"/>
  <circle cx="256" cy="256" r="182" fill="${felt}"/>
  <path d="${spade}" fill="${accent}"/>
</svg>
`;
}

function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

mkdirSync(outDir, { recursive: true });
const anySvg = iconSvg({ rounded: true });
// Maskable/Apple: vollflächig, das System rundet bzw. maskiert selbst.
const fullSvg = iconSvg({ rounded: false });

const files = {
  'icon.svg': anySvg,
  'icon-192.png': png(anySvg, 192),
  'icon-512.png': png(anySvg, 512),
  'icon-maskable-512.png': png(fullSvg, 512),
  'apple-touch-icon.png': png(fullSvg, 180),
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(new URL(name, outDir), content);
  console.log(`public/icons/${name}`);
}
