// WP-018: komplette Runde mit drei echten Browsern gegen den laufenden Game-Server.
// Drei registrierte Test-User (`wp018_…`), Tisch über `/dev/new-table`, alle setzen sich, der Ersteller
// startet, zwei Hände bis zum Showdown, dann All-in bis zum Rundenende-Dialog bei allen; danach „Nochmal“.
import { expect, test, type Page } from '@playwright/test';
import { apiPlayer, deleteAccount, playUntilRoundEnds, uniqueName } from './helpers';

const pages: Page[] = [];

// Test-User wieder löschen (DELETE /api/me), auch wenn der Test scheitert.
test.afterEach(async () => {
  const errors = (await Promise.all(pages.splice(0).map(deleteAccount))).filter((e) => e !== null);
  expect(errors, 'Test-User aufräumen').toEqual([]);
});

test('komplette Runde mit drei Browsern', async ({ browser }) => {
  const suffix = Date.now().toString(36).slice(-6);
  for (const p of ['a', 'b', 'c']) await apiPlayer(browser, uniqueName('wp018_', p), pages);
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
  const results = await playUntilRoundEnds(pages, 2, 150_000);

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
  await expect(second.getByRole('button', { name: 'Nochmal' })).toHaveCount(0); // nur der Ersteller

  // „Nochmal“ (D-020): neue Runde am selben Tisch, Dialog schließt bei allen
  await creator.getByTestId('finished-panel').getByRole('button', { name: 'Nochmal' }).click();
  for (const page of pages) {
    await expect(page.getByTestId('round-result')).toHaveCount(0);
    await expect(page.getByTestId('timer')).toBeVisible();
  }
});
