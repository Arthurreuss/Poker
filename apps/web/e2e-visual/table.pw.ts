/**
 * Screenshot- und Geometrie-Tests der Tischansicht im Hochformat (WP-016).
 * Prüft pro Mock-Zustand und Viewport per Bounding-Box:
 * - Teile verschiedener Sitze (Plakette, Karten, Marker, Status-Etikett) überlappen sich nicht,
 * - Einsätze, Pots, Board und Kopfzeile überlappen keine Sitze und einander nicht,
 * - alles liegt im Viewport und oberhalb der freien Fläche für die Aktionsleiste (WP-018),
 * - Texte sind nicht abgeschnitten und mindestens 11 px groß.
 * Ausführen: `npm run test:visual -w @poker/web` (Baselines aktualisieren: `-- --update-snapshots`).
 */
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 430, height: 932 },
] as const;

/** Mock-Zustände mit Screenshot-Baseline (2, 6 und 9 Spieler). */
const STATES = [
  { id: 'heads-up', players: 2 },
  { id: 'six-flop', players: 6 },
  { id: 'six-showdown', players: 6 },
  { id: 'six-disconnected', players: 6 },
  { id: 'nine-preflop', players: 9 },
  { id: 'nine-allin', players: 9 },
] as const;

/** Weitere Spielerzahlen: nur Geometrie-Prüfung, ohne Screenshot-Baseline. */
const LAYOUT_ONLY = [3, 4, 5, 7, 8].map((n) => ({ id: `players-${String(n)}`, players: n }));

interface Box {
  /** Teile mit derselben Gruppe (z. B. ein Sitz) dürfen sich überlappen. */
  group: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Geometry {
  boxes: Box[];
  actionTop: number;
  truncated: string[];
  tooSmall: string[];
}

async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const box = (group: string, name: string, el: Element) => {
      const r = el.getBoundingClientRect();
      return { group, name, x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const all = (selector: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(selector)];
    const one = (selector: string) => {
      const el = document.querySelector(selector);
      if (el === null) throw new Error(`${selector} fehlt`);
      return el;
    };
    const boxes = [
      ...all('[data-testid="seat"]').flatMap((seat) => {
        const group = `Sitz ${seat.dataset['seat'] ?? '?'} (${seat.dataset['slot'] ?? '?'})`;
        return [
          ...all('[data-testid="seat-plate"]', seat).map((el) => box(group, `${group} Plakette`, el)),
          ...all('.pt-card', seat).map((el, i) => box(group, `${group} Karte ${String(i + 1)}`, el)),
          ...all('[data-testid="marker"]', seat).map((el) => box(group, `${group} Marker`, el)),
          ...all('[data-testid="status"]', seat).map((el) => box(group, `${group} Status`, el)),
        ];
      }),
      ...all('[data-testid="bet"]').map((el, i) => box(`bet ${String(i)}`, `Einsatz ${el.textContent}`, el)),
      ...all('[data-testid="pot"]').map((el, i) => box(`pot ${String(i)}`, `Pot ${el.textContent}`, el)),
      box('board', 'Board', one('[data-testid="board"]')),
      box('blinds', 'Kopfzeile', one('[data-testid="blinds"] .pt-text')),
    ];
    const actionTop = one('[data-testid="action-slot"]').getBoundingClientRect().top;
    const texts = all('.pt-text, .pt-bet, .pt-pot, .pt-pill');
    const truncated = texts.filter((t) => t.scrollWidth > t.clientWidth + 0.5).map((t) => t.textContent);
    const tooSmall = texts
      .filter((t) => parseFloat(getComputedStyle(t).fontSize) < 11)
      .map((t) => `${t.textContent} (${getComputedStyle(t).fontSize})`);
    return { boxes, actionTop, truncated, tooSmall };
  });
}

function fmt(b: Box): string {
  return `[${[b.x, b.y, b.x + b.w, b.y + b.h].map((v) => String(Math.round(v))).join(',')}]`;
}

function overlaps(a: Box, b: Box): boolean {
  const eps = 0.5;
  return a.x + a.w - eps > b.x && b.x + b.w - eps > a.x && a.y + a.h - eps > b.y && b.y + b.h - eps > a.y;
}

function findProblems(g: Geometry, vp: { width: number; height: number }): string[] {
  const problems: string[] = [];
  for (const b of g.boxes) {
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > vp.width + 0.5 || b.y + b.h > vp.height + 0.5) {
      problems.push(`${b.name} außerhalb des Viewports ${fmt(b)}`);
    }
    if (b.y + b.h > g.actionTop + 0.5) {
      problems.push(
        `${b.name} ragt in die Fläche der Aktionsleiste ${fmt(b)}, Leiste ab y=${String(Math.round(g.actionTop))}`,
      );
    }
  }
  g.boxes.forEach((a, i) => {
    for (const b of g.boxes.slice(i + 1)) {
      if (a.group !== b.group && overlaps(a, b)) problems.push(`${a.name} ${fmt(a)} überlappt ${b.name} ${fmt(b)}`);
    }
  });
  for (const t of g.truncated) problems.push(`Text abgeschnitten: „${t}“`);
  for (const t of g.tooSmall) problems.push(`Schrift zu klein: ${t}`);
  return problems;
}

for (const vp of VIEWPORTS) {
  test.describe(`${String(vp.width)}×${String(vp.height)}`, () => {
    test.use({ viewport: vp });

    for (const state of [...STATES, ...LAYOUT_ONLY]) {
      const withScreenshot = STATES.some((s) => s.id === state.id);
      test(`${state.id} (${String(state.players)} Spieler)`, async ({ page }) => {
        await page.goto(`/table-dev.html?state=${state.id}&bare=1`);
        await expect(page.getByTestId('seat')).toHaveCount(state.players);
        await page.evaluate(() => document.fonts.ready);

        expect.soft(findProblems(await measure(page), vp)).toEqual([]);

        if (withScreenshot) {
          await expect(page).toHaveScreenshot(`${state.id}-${String(vp.width)}x${String(vp.height)}.png`);
        }
      });
    }
  });
}
