/**
 * Lottie-Animationen der Feiern (WP-040), als JSON im Bundle (CSP: nur eigene Origin, D-014) und erst bei Bedarf
 * geladen (eigene Chunks). Quelle und Lizenz: `../ASSETS.md`.
 */
export type ClipLoader = () => Promise<{ default: unknown }>;

/** Je Hand ein anderes (`CelebrationView.confetti`); Reihenfolge = Rotation. Anzahl = `CONFETTI_COUNT`. */
export const CONFETTI_CLIPS: readonly ClipLoader[] = [
  () => import('./clips/konfetti-kanone.json'),
  () => import('./clips/konfetti-bunt.json'),
  () => import('./clips/konfetti-feuerwerk.json'),
  () => import('./clips/konfetti-party.json'),
  () => import('./clips/konfetti-regen.json'),
  () => import('./clips/konfetti-schlangen.json'),
  () => import('./clips/konfetti-knall.json'),
];

/** Münzen nach Pot-Größe, kumulativ: Stufe 1 = klein, 2 = + Stapel, 3 = + Regen. */
export const COIN_CLIPS: readonly ClipLoader[] = [
  () => import('./clips/muenzen-klein.json'),
  () => import('./clips/muenzen-stapel.json'),
  () => import('./clips/muenzen-regen.json'),
];

/** Sieger des ganzen Tisches (Rundenende). */
export const WINNER_CLIP: ClipLoader = () => import('./clips/tisch-sieger.json');
