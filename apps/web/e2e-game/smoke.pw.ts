// WP-020: E2E-Smoke-Test – beweist, dass das Gesamtsystem (Web, Server, DB, WebSocket) zusammen funktioniert.
// Zwei Spieler registrieren sich über die Seite, A erstellt über die Lobby einen privaten Tisch, B tritt über den
// Einladungslink bei, beide nehmen Platz, A startet, beide gehen All-in, bis der Rundenende-Dialog bei beiden
// steht. Danach werden beide Test-Konten gelöscht (auch in prod, auch wenn der Test scheitert). Privat, damit in
// prod keine Spuren öffentlich sichtbar sind: nicht in der Lobby, Ergebnis nur für Teilnehmer (D-024, D-028).
// Läuft gegen dev (localhost:4310), prod (localhost:4320 über den Origin-Proxy, D-028) oder den eigenen Vite.
import { expect, test, type Page } from '@playwright/test';
import { deleteAccount, playUntilRoundEnds, registerViaUi, uniqueName } from './helpers';

const pages: Page[] = [];

test.afterEach(async () => {
  const errors = (await Promise.all(pages.splice(0).map(deleteAccount))).filter((e) => e !== null);
  expect(errors, 'Test-Konten löschen').toEqual([]);
});

test('zwei Spieler: Registrierung, privater Tisch über Lobby und Einladung, Runde bis zum Ende', async ({
  browser,
}) => {
  const nameA = uniqueName('e2e_', 'a');
  const nameB = uniqueName('e2e_', 'b');
  const tableName = `E2E-Test ${nameA}`;

  const a = await registerViaUi(browser, nameA, pages);
  const b = await registerViaUi(browser, nameB, pages);
  await expect(a.getByText(`Hallo ${nameA}!`)).toBeVisible();

  // A: privaten Tisch über die Lobby erstellen (2 Plätze, feste Blinds, kleiner Stack → kurze Runde)
  await expect(a.getByRole('status', { name: 'Verbindung: Verbunden' })).toBeVisible(); // WS steht
  await a.getByRole('button', { name: 'Tisch erstellen' }).click();
  const form = a.getByRole('form', { name: 'Tisch erstellen' });
  await form.getByLabel('Tischname').fill(tableName);
  await form.getByLabel('Startstack').fill('200');
  await form.getByLabel('Plätze').selectOption('2');
  await form.getByLabel('Fest').check();
  await form.getByLabel('Privat (nur per Einladungslink)').check();
  await form.getByRole('button', { name: 'Tisch erstellen' }).click();
  const created = a.getByRole('region', { name: 'Privater Tisch erstellt' });
  const invitePath = new URL(await created.getByLabel('Einladungslink').inputValue()).pathname;
  expect(invitePath).toMatch(/^\/join\/.+/);
  await expect(a.getByRole('button', { name: `Beitreten: ${tableName}` })).toHaveCount(0); // nicht in der Lobby
  await created.getByRole('button', { name: 'Zum Tisch' }).click();
  await a.waitForURL(/\/table\/\d+$/);
  const tablePath = new URL(a.url()).pathname;
  await a.getByRole('button', { name: 'Platz nehmen' }).click();
  await expect(a.getByRole('button', { name: 'Aufstehen' })).toBeVisible();

  // B: über den Einladungslink beitreten (Pfad relativ zur baseURL, z. B. hinter dem Origin-Proxy)
  await b.goto(invitePath);
  await b.waitForURL((url) => url.pathname === tablePath);
  await b.getByRole('button', { name: 'Platz nehmen' }).click();
  await expect(b.getByRole('button', { name: 'Aufstehen' })).toBeVisible();

  for (const page of pages) await expect(page.getByText('2/2 Spieler')).toBeVisible();
  await expect(b.getByRole('button', { name: 'Runde starten' })).toHaveCount(0);
  await a.getByRole('button', { name: 'Runde starten' }).click();

  // Runde läuft: beide sehen den Timer; All-in beschleunigt bis zum Rundenende
  for (const page of pages) await expect(page.getByTestId('timer')).toBeVisible();
  await playUntilRoundEnds(pages, 0, 120_000);

  // Rundenende-Dialog bei beiden: zwei Platzierungen, derselbe Sieger, ein Spieler ist es selbst
  for (const page of pages) {
    const dialog = page.getByTestId('round-result');
    await expect(dialog.getByRole('heading', { name: 'Runde beendet' })).toBeVisible();
    await expect(dialog.getByTestId('standing')).toHaveCount(2);
    await expect(dialog.getByText(/Du hast gewonnen!|hat gewonnen\./)).toBeVisible();
  }
  const winners = await Promise.all(pages.map((p) => p.getByTestId('standing').first().textContent()));
  expect(new Set(winners).size).toBe(1);
  expect([nameA, nameB].some((n) => winners[0]?.includes(n))).toBe(true);
});
