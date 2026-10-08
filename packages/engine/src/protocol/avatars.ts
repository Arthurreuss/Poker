/**
 * Avatare und Emoji-Reaktionen (WP-032): feste Auswahl, die Server (Validierung, DB) und Web (Darstellung)
 * teilen. Die Grafiken selbst liegen nur im Web (`apps/web/src/avatars/`); hier stehen nur die IDs.
 * Neue IDs dürfen hinten angehängt werden; entfernte IDs müssten per Migration in `users.avatar` auf `NULL`.
 */

/** Wählbare Avatare (`users.avatar`); `null` = keiner gewählt (Anzeige: Anfangsbuchstabe). */
export const AVATAR_IDS = [
  'fox',
  'cat',
  'owl',
  'bear',
  'rabbit',
  'frog',
  'panda',
  'penguin',
  'lion',
  'pig',
  'mouse',
  'dog',
  'chip',
  'spade',
  'heart',
  'diamond',
  'club',
  'crown',
  'star',
  'moon',
  'rocket',
  'ghost',
  'robot',
  'cactus',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

const AVATAR_SET: ReadonlySet<string> = new Set(AVATAR_IDS);

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && AVATAR_SET.has(value);
}

/** Emoji-Reaktionen am Tisch (`table.react`); die Zeichen dazu legt der Client fest. */
export const REACTION_IDS = ['thumbs-up', 'clap', 'laugh', 'wow', 'cry', 'angry', 'fire', 'think'] as const;

export type ReactionId = (typeof REACTION_IDS)[number];

const REACTION_SET: ReadonlySet<string> = new Set(REACTION_IDS);

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === 'string' && REACTION_SET.has(value);
}

/** Server-Rate-Limit: höchstens eine Reaktion pro User in diesem Abstand (sonst `RATE_LIMITED`). */
export const REACTION_COOLDOWN_MS = 2000;
