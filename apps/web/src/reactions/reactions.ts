// Emoji-Reaktionen am Tisch (WP-032): Zeichen und Beschriftung je Reaktions-ID aus dem Protokoll.
// Die Emojis kommen aus der Systemschrift des Geräts (keine eigenen Grafiken).
import { REACTION_IDS, type ReactionId } from '@poker/engine/protocol';

export interface ReactionInfo {
  readonly emoji: string;
  readonly label: string;
}

export const REACTIONS: Readonly<Record<ReactionId, ReactionInfo>> = {
  'thumbs-up': { emoji: '👍', label: 'Daumen hoch' },
  clap: { emoji: '👏', label: 'Applaus' },
  laugh: { emoji: '😂', label: 'Lachen' },
  wow: { emoji: '😮', label: 'Staunen' },
  cry: { emoji: '😢', label: 'Traurig' },
  angry: { emoji: '😠', label: 'Ärger' },
  fire: { emoji: '🔥', label: 'Heiß' },
  think: { emoji: '🤔', label: 'Nachdenklich' },
};

/** Reihenfolge im Auswahlmenü. */
export const REACTION_ORDER: readonly ReactionId[] = REACTION_IDS;
