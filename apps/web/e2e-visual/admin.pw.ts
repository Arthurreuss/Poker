/**
 * Mobil-Tests des Admin-Dashboards (WP-029): echte App (index.html) mit gemockter API (`page.route`), Admin
 * eingeloggt. Pro Viewport und Bereich (Übersicht, Spieler, Tische, Protokoll, Dialoge) wird geprüft:
 * - keine horizontale Scrollleiste, nichts ragt rechts aus dem Viewport,
 * - alle Knöpfe und Bereichs-Links sind mindestens 44 px hoch (Touch-Ziel),
 * - Screenshot-Baseline für die Hochformat-Handys.
 * Ausführen: `npm run test:visual -w @poker/web` (Baselines aktualisieren: `-- --update-snapshots`).
 */
import { expect, test, type Page } from '@playwright/test';

const VIEWPORTS = [
  { width: 360, height: 740, screenshot: true },
  { width: 430, height: 932, screenshot: true },
  { width: 932, height: 430, screenshot: false },
] as const;

const ADMIN = { id: 1, username: 'arthur', isAdmin: true };

const OVERVIEW = {
  generatedAt: '2026-10-08T12:00:00.000Z',
  tables: { total: 3, open: 1, running: 2, seatedPlayers: 7 },
  onlineUsers: 9,
  rounds: {
    today: { started: 4, finished: 2, aborted: 1, running: 1 },
    week: { started: 23, finished: 21, aborted: 1, running: 1 },
    timeZone: 'Europe/Berlin',
    weekDays: 7,
  },
  feedbackNew: 5,
  health: { db: 'ok', dbLatencyMs: 1.3, uptimeSeconds: 273_600, nodeVersion: 'v22.20.0', memoryMb: 87 },
};

const user = (id: number, username: string, extra: object = {}) => ({
  id,
  username,
  isAdmin: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  bannedAt: null,
  sessions: 2,
  ...extra,
});

const USERS = [
  user(1, 'arthur', { isAdmin: true, sessions: 1 }),
  user(2, 'spieler_mit_langem_n', {}),
  user(3, 'gesperrt', { bannedAt: '2026-10-01T10:00:00.000Z', sessions: 0 }),
  user(4, 'Zoe'),
];

const TABLES = [
  {
    id: 7,
    name: 'Freitagsrunde mit sehr langem Namen',
    isPublic: false,
    status: 'running',
    createdBy: { id: 2, username: 'spieler_mit_langem_n' },
    maxSeats: 9,
    players: Array.from({ length: 6 }, (_, i) => ({
      seat: i,
      id: 10 + i,
      username: `spieler_${String(i)}`,
      connected: i !== 2,
    })),
    watchers: 5,
    roundId: 12,
    handNumber: 3,
  },
  {
    id: 8,
    name: 'Offen',
    isPublic: true,
    status: 'open',
    createdBy: { id: 4, username: 'Zoe' },
    maxSeats: 6,
    players: [{ seat: 0, id: 4, username: 'Zoe', connected: true }],
    watchers: 1,
    roundId: null,
    handNumber: null,
  },
];

const AUDIT = [
  {
    id: 3,
    createdAt: '2026-10-08T11:00:00.000Z',
    action: 'user.ban',
    source: 'api',
    admin: { id: 1, username: 'arthur' },
    targetUser: { id: 3, username: 'gesperrt' },
    targetTableId: null,
    details: { reason: 'Hat wiederholt absichtlich die Runde verschleppt und Mitspieler beleidigt.' },
  },
  {
    id: 2,
    createdAt: '2026-10-07T20:00:00.000Z',
    action: 'table.close',
    source: 'api',
    admin: { id: 1, username: 'arthur' },
    targetUser: null,
    targetTableId: 5,
    details: {},
  },
  {
    id: 1,
    createdAt: '2026-10-01T09:00:00.000Z',
    action: 'user.admin_grant',
    source: 'cli',
    admin: null,
    targetUser: { id: 1, username: 'arthur' },
    targetTableId: null,
    details: {},
  },
];

async function mockApi(page: Page): Promise<void> {
  // Nur echte API-Pfade – ein Glob wie **/api/** träfe auch Vite-Module (src/api/*.ts).
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const url = new URL(route.request().url());
      const key = `${route.request().method()} ${url.pathname}`;
      const bodies: Record<string, unknown> = {
        'GET /api/me': { user: ADMIN },
        'GET /api/health': { status: 'ok', db: 'ok' },
        'GET /api/admin/overview': { overview: OVERVIEW },
        'GET /api/admin/users': { users: USERS },
        'GET /api/admin/tables': { tables: TABLES },
        'GET /api/admin/audit': { entries: AUDIT },
        'POST /api/admin/users/2/password': { password: 'Xy7kP2mQ9rTz4wLb' },
      };
      const body = bodies[key];
      await route.fulfill(
        body === undefined
          ? { status: 404, json: { error: 'not_found', message: `Mock fehlt: ${key}` } }
          : { status: 200, json: body },
      );
    },
  );
}

interface Problems {
  overflow: string[];
  small: string[];
}

async function measure(page: Page): Promise<Problems> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow: string[] = [];
    if (document.documentElement.scrollWidth > vw) {
      overflow.push(`Seite ${String(document.documentElement.scrollWidth)} > ${String(vw)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('main *, [role="dialog"] *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) overflow.push(`${el.tagName} „${el.textContent.slice(0, 30)}“`);
    }
    const small = [
      ...document.querySelectorAll<HTMLElement>(
        'main button, [role="dialog"] button, nav[aria-label="Admin-Bereiche"] a',
      ),
    ]
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => `${el.textContent} (${String(el.getBoundingClientRect().height)} px)`);
    return { overflow, small };
  });
}

async function check(page: Page, name: string, screenshot: boolean, width: number, height: number) {
  const problems = await measure(page);
  expect(problems.overflow, `${name}: ragt aus dem Viewport`).toEqual([]);
  expect(problems.small, `${name}: Touch-Ziele unter 44 px`).toEqual([]);
  if (screenshot) {
    await expect(page).toHaveScreenshot(`admin-${name}-${String(width)}x${String(height)}.png`, { fullPage: true });
  }
}

test.use({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });

for (const { width, height, screenshot } of VIEWPORTS) {
  test.describe(`${String(width)}x${String(height)}`, () => {
    test.use({ viewport: { width, height } });

    test.beforeEach(async ({ page }) => {
      await mockApi(page);
    });

    test('Übersicht', async ({ page }) => {
      await page.goto('/admin');
      await expect(page.getByLabel('Kennzahlen')).toBeVisible();
      await check(page, 'overview', screenshot, width, height);
    });

    test('Spieler mit Sperr-Dialog und Passwort', async ({ page }) => {
      await page.goto('/admin/players');
      await expect(page.getByRole('heading', { level: 3, name: 'gesperrt' })).toBeVisible();
      await check(page, 'players', screenshot, width, height);

      await page.getByRole('button', { name: 'Sperren' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, 'ban-dialog', screenshot, width, height);
      await page.getByRole('button', { name: 'Abbrechen' }).click();

      await page.getByRole('button', { name: 'Passwort zurücksetzen' }).nth(1).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Passwort zurücksetzen' }).click();
      await expect(page.getByTestId('reset-password')).toHaveText('Xy7kP2mQ9rTz4wLb');
      await check(page, 'password-dialog', screenshot, width, height);
    });

    test('Tische', async ({ page }) => {
      await page.goto('/admin/tables');
      await expect(page.getByRole('heading', { level: 3, name: 'Offen' })).toBeVisible();
      await check(page, 'tables', screenshot, width, height);
    });

    test('Protokoll', async ({ page }) => {
      await page.goto('/admin/audit');
      await expect(page.getByText('Spieler gesperrt · gesperrt')).toBeVisible();
      await check(page, 'audit', screenshot, width, height);
    });
  });
}
