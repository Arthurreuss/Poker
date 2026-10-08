// Gemeinsame Hilfen der Playwright-Spieltests (WP-018 Runde mit drei Browsern, WP-020 E2E-Smoke-Test).
import { expect, type Browser, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-passwort-123';

/** Eindeutiger, gültiger Benutzername (3–20 Zeichen, A–Z a–z 0–9 _ -). */
export function uniqueName(prefix: string, tag: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 36 ** 3)
    .toString(36)
    .padStart(3, '0');
  return `${prefix}${stamp}${rand}${tag}`.slice(0, 20);
}

/**
 * Neuer Browser-Kontext, User per API registriert (eingeloggt). Ein Rate-Limit (429) der Auth-Routen wird
 * abgewartet (wiederholt mit wachsendem Abstand). Die Seite kommt sofort in `track` (Aufräumen).
 */
export async function apiPlayer(browser: Browser, name: string, track: Page[]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  track.push(page);
  await expect(async () => {
    const res = await page.request.post('/api/register', { data: { username: name, password: PASSWORD } });
    expect(res.status(), await res.text()).toBe(201);
  }).toPass({ intervals: [1_000, 2_000, 5_000, 10_000], timeout: 70_000 });
  return page;
}

/**
 * Registrierung über die Seite `/register`; danach steht die Lobby. 429 → nach kurzer Wartezeit erneut.
 * Die Seite kommt sofort in `track`, damit das Aufräumen sie auch erwischt, wenn die Registrierung scheitert.
 */
export async function registerViaUi(browser: Browser, name: string, track: Page[]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  track.push(page);
  await page.goto('/register');
  await page.getByLabel('Benutzername').fill(name);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD);
  const lobby = page.getByRole('heading', { name: 'Lobby' });
  await expect(async () => {
    const alert = page.getByRole('alert');
    if (await alert.isVisible()) {
      // Nur das Rate-Limit ist vorübergehend; jede andere Meldung lässt den Test sofort scheitern.
      await expect(alert).toHaveText(/Zu viele Versuche/, { timeout: 100 });
    }
    if (!(await lobby.isVisible())) {
      await page.getByRole('button', { name: 'Konto anlegen' }).click({ timeout: 2_000 });
    }
    await expect(lobby).toBeVisible({ timeout: 3_000 });
  }).toPass({ intervals: [1_000, 2_000, 5_000, 10_000], timeout: 70_000 });
  return page;
}

/**
 * Konto löschen (`DELETE /api/me` mit Passwort, WP-022) – Aufräumen der Test-User, auch in prod.
 * Fehler werden zurückgegeben statt geworfen, damit das Aufräumen alle User versucht.
 */
export async function deleteAccount(page: Page): Promise<string | null> {
  try {
    let status = 0;
    await expect(async () => {
      const res = await page.request.delete('/api/me', { data: { password: PASSWORD } });
      status = res.status();
      expect(status).not.toBe(429);
    }).toPass({ intervals: [1_000, 2_000, 5_000, 10_000], timeout: 70_000 });
    return status === 204 || status === 401 ? null : `DELETE /api/me: HTTP ${String(status)}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Am Zug: `passive` = Check/Call; sonst All-in (direkt, über die Einsatzwahl oder per Call ins All-in).
 * `false`, wenn die Seite nicht am Zug ist.
 */
export async function play(page: Page, passive: boolean): Promise<boolean> {
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
    // isEnabled wartet ohne Timeout auf das Element – endet die Hand gerade, hinge der Test bis zum Timeout.
    if (await wager.isEnabled(quick)) {
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

/**
 * Spielt, bis bei allen der Rundenende-Dialog steht. `passiveHands` Hände werden durchgecheckt/-gecallt,
 * danach geht jeder am Zug All-in. Gewartet wird auf Zustände (Aktionsleiste am Zug oder Dialog), nicht auf Zeit.
 * Liefert die Zahl der angezeigten Hand-Ergebnisse.
 */
export async function playUntilRoundEnds(pages: readonly Page[], passiveHands: number, timeoutMs: number) {
  let results = 0;
  let resultVisible = false;
  const deadline = Date.now() + timeoutMs;
  const anyTurnOrEnd = (page: Page) =>
    page.locator('[data-testid="action-bar"][data-mode="turn"], [data-testid="round-result"]');
  for (;;) {
    const done = await Promise.all(pages.map((p) => p.getByTestId('round-result').isVisible()));
    if (done.every(Boolean)) return results;
    if (Date.now() > deadline) throw new Error('Runde nicht beendet');
    const gone = await Promise.all(pages.map((p) => p.getByText('Diesen Tisch gibt es nicht (mehr).').isVisible()));
    if (gone.some(Boolean)) throw new Error('Tisch verschwunden – Game-Server neu gestartet?');
    let acted = false;
    for (const page of pages) acted = (await play(page, results < passiveHands)) || acted;
    const visible = (await Promise.all(pages.map((p) => p.getByTestId('hand-result').isVisible()))).some(Boolean);
    if (visible && !resultVisible) results += 1;
    resultVisible = visible;
    if (!acted) {
      // Warten, bis irgendwo jemand am Zug ist oder die Runde vorbei ist (kein fester Sleep).
      await Promise.race(pages.map((p) => anyTurnOrEnd(p).first().waitFor({ timeout: 1_000 }))).catch(() => undefined);
    }
  }
}
