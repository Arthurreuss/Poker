// Einladungslinks für private Tische (WP-015): `/join/<inviteCode>` unter derselben Origin (D-014).

/** Pfad der Einladungsseite. */
export function invitePath(inviteCode: string): string {
  return `/join/${encodeURIComponent(inviteCode)}`;
}

/** Vollständiger Link zum Teilen, z. B. `https://poker.example/join/abc`. */
export function inviteUrl(inviteCode: string, origin: string = window.location.origin): string {
  return `${origin}${invitePath(inviteCode)}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'manual';

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
