// WP-018: komplette Runde mit drei echten Browsern gegen den laufenden Game-Server.
// Drei registrierte Test-User (`wp018_…`), Tisch über `/dev/new-table`, alle setzen sich, der Ersteller
// startet, alle gehen jede Hand All-in, bis der Rundenende-Dialog bei allen erscheint.
import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'wp018-passwort';

async function player(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const res = await page.request.post('/api/register', { data: { username: name, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(201);
  return page;
}

/**
 * Am Zug: `passive` = Check/Call; sonst All-in (direkt, über die Einsatzwahl oder per Call ins All-in).
 * `false`, wenn die Seite nicht am Zug ist.
 */
async function play(page: Page, passive: boolean): Promise<boolean> {
  const bar = page.locator('[data-testid="action-bar"][data-mode="turn"]');
  if (!(await bar.isVisible())) return false;
  const quick = { timeout: 2_000 };
  try {
    if (passive) {
      await bar
        .getByRole('button', { name: /^(Check|Call|All-in)/ })
        .first()
        .click(quick);
      return true;
    }
    const allIn = bar.getByRole('button', { name: /^All-in/ });
    if (await allIn.isVisible()) {
      await allIn.click(quick);
      return true;
    }
    const wager = bar.getByRole('button', { name: /^(Raise|Bet)/ });
    if (await wager.isEnabled()) {
      await wager.click(quick);
      await bar.getByRole('dialog').getByRole('button', { name: 'All-in', exact: true }).click(quick);
      await bar
        .locator('.ab-row')
        .getByRole('button', { name: /^All-in/ })
        .click(quick);
      return true;
    }
    const call = bar.getByRole('button', { name: /^(Call|Check)/ });
    await call.click(quick);
    return true;
  } catch {
    return false; // Zustand hat sich währenddessen geändert – nächster Durchlauf
  }
}

test('komplette Runde mit drei Browsern', async ({ browser }) => {
  const suffix = Date.now().toString(36).slice(-6);
  const pages = await Promise.all(['a', 'b', 'c'].map((p) => player(browser, `wp018_${p}${suffix}`)));
  const [creator, second, third] = pages;
  if (creator === undefined || second === undefined || third === undefined) throw new Error('3 Browser erwartet');
  const others = [second, third];

  // Tisch anlegen (Dev-Helfer, bis es die Lobby gibt)
  await creator.goto('/dev/new-table');
  await creator.getByLabel('Name').fill(`wp018 ${suffix}`);
  await creator.getByLabel('Startstack').fill('300');
  await creator.getByRole('button', { name: 'Tisch anlegen' }).click();
  await creator.waitForURL(/\/table\/\d+$/);
  const url = new URL(creator.url()).pathname;
  for (const page of others) await page.goto(url);

  // Platz nehmen und starten
  await expect(creator.getByRole('button', { name: 'Aufstehen' })).toBeVisible(); // Dev-Helfer setzt ihn
  for (const page of others) {
    await page.getByRole('button', { name: 'Platz nehmen' }).click();
    await expect(page.getByRole('button', { name: 'Aufstehen' })).toBeVisible();
  }
  for (const page of pages) await expect(page.getByText('3/9 Spieler')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Runde starten' })).toHaveCount(0);
  await creator.getByRole('button', { name: 'Runde starten' }).click();

  // Erste Hand: genau einer ist am Zug und sieht den Timer-Ring, die anderen Vorab-Aktionen
  for (const page of pages) await expect(page.getByTestId('timer')).toBeVisible();
  await expect
    .poll(async () => {
      const modes = await Promise.all(pages.map((p) => p.getByTestId('action-bar').getAttribute('data-mode')));
      return modes.sort().join(',');
    })
    .toBe('pre,pre,turn');

  // Vorab-Aktion: wer nicht am Zug ist, wählt „Call any“ – sie wird ausgelöst bzw. verfällt
  const preBars = pages.map((p) => p.locator('[data-testid="action-bar"][data-mode="pre"]'));
  const preBar = (await Promise.all(preBars.map((b) => b.isVisible()))).includes(true)
    ? preBars[(await Promise.all(preBars.map((b) => b.isVisible()))).indexOf(true)]
    : undefined;
  if (preBar === undefined) throw new Error('niemand mit Vorab-Aktionen');
  const callAny = preBar.getByRole('button', { name: 'Call any' });
  await callAny.click();
  await expect(callAny).toHaveAttribute('aria-pressed', 'true');

  // Zwei Hände bis zum Showdown durchchecken/-callen, danach All-in, bis die Runde vorbei ist
  let results = 0;
  let resultVisible = false;
  const deadline = Date.now() + 150_000;
  for (;;) {
    const done = await Promise.all(pages.map((p) => p.getByTestId('round-result').isVisible()));
    if (done.every(Boolean)) break;
    if (Date.now() > deadline) throw new Error('Runde nicht beendet');
    const gone = await Promise.all(pages.map((p) => p.getByText('Diesen Tisch gibt es nicht (mehr).').isVisible()));
    if (gone.some(Boolean)) throw new Error('Tisch verschwunden – Game-Server neu gestartet?');
    let acted = false;
    for (const page of pages) acted = (await play(page, results < 2)) || acted;
    const visible = (await Promise.all(pages.map((p) => p.getByTestId('hand-result').isVisible()))).some(Boolean);
    if (visible && !resultVisible) results += 1;
    resultVisible = visible;
    if (!acted) await creator.waitForTimeout(200);
  }

  // Showdowns wurden angezeigt (mindestens die zwei passiven Hände)
  expect(results).toBeGreaterThanOrEqual(2);
  for (const page of pages) {
    const dialog = page.getByTestId('round-result');
    await expect(dialog.getByTestId('standing')).toHaveCount(3);
    await expect(dialog.getByRole('heading', { name: 'Runde beendet' })).toBeVisible();
  }
  // Platz 1 ist bei allen derselbe Spieler
  const winners = await Promise.all(pages.map((p) => p.getByTestId('standing').first().textContent()));
  expect(new Set(winners).size).toBe(1);

  // Dialog schließen, Ergebnis bleibt abrufbar
  await creator.getByRole('button', { name: 'Schließen' }).click();
  await expect(creator.getByTestId('finished-panel')).toBeVisible();
});
