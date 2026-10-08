// Tisch-Links teilen (WP-015, WP-030): private Tische per `/join/<inviteCode>`, öffentliche per `/table/<id>`,
// immer unter derselben Origin (D-014). Die Link-Vorschau im Messenger (Open Graph) ist allgemein und verrät
// keine Tischdaten (apps/web/index.html, docker/nginx/default.conf.template).

/** Pfad der Einladungsseite. */
export function invitePath(inviteCode: string): string {
  return `/join/${encodeURIComponent(inviteCode)}`;
}

/** Pfad der Tischseite (öffentliche Tische betritt jeder Eingeloggte direkt). */
export function tablePath(tableId: number): string {
  return `/table/${String(tableId)}`;
}

/** Vollständiger Link zum Teilen, z. B. `https://poker.example/join/abc`. */
export function shareUrl(path: string, origin: string = window.location.origin): string {
  return `${origin}${path}`;
}

/** Vollständiger Einladungslink eines privaten Tisches. */
export function inviteUrl(inviteCode: string, origin: string = window.location.origin): string {
  return shareUrl(invitePath(inviteCode), origin);
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'manual';

/**
 * Ob das Teilen-Menü des Geräts angeboten wird: Web Share API vorhanden **und** Touch-Gerät (grober Zeiger).
 * Am Desktop wird stattdessen kopiert – dort ist das System-Teilen-Menü (z. B. unter Windows) eher ungewohnt.
 */
export function canShareNatively(nav: Navigator = navigator, win: Pick<Window, 'matchMedia'> = window): boolean {
  if (typeof nav.share !== 'function') return false;
  if (typeof win.matchMedia !== 'function') return false;
  return win.matchMedia('(pointer: coarse)').matches;
}

/**
 * Teilt den Link über das Teilen-Menü des Geräts (Web Share API); ohne diese oder bei Fehler wird er in die
 * Zwischenablage kopiert. `manual`: beides ging nicht – der Link muss von Hand kopiert werden.
 */
export async function shareInvite(url: string, tableName: string, nav: Navigator = navigator): Promise<ShareResult> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'Einladung zum Pokertisch', text: `Komm an meinen Tisch „${tableName}“`, url });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  return copyInvite(url, nav);
}

/** Kopiert den Link; `manual`, wenn die Zwischenablage nicht verfügbar ist. */
export async function copyInvite(url: string, nav: Navigator = navigator): Promise<'copied' | 'manual'> {
  try {
    // Ohne sicheren Kontext (http außer localhost) fehlt `clipboard` trotz der DOM-Typen.
    const clipboard = nav.clipboard as Clipboard | undefined;
    if (clipboard === undefined) return 'manual';
    await clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'manual';
  }
}
