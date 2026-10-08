// Avatar eines Accounts (WP-032): feste Auswahl aus `AVATAR_IDS` (@poker/engine/protocol), gespeichert in
// `users.avatar` (Migration 0008). Beschreibung: docs/ARCHITECTURE.md, „Auth“ → „Avatar“.
import { isAvatarId, type AvatarId } from '@poker/engine/protocol';
import type { Queryable } from '../db';

/**
 * DB-Wert → Avatar-ID. Unbekannte Werte (z. B. ein später entfernter Avatar) gelten als „keiner“, damit
 * Clients nie eine ID bekommen, die sie nicht darstellen können.
 */
export function toAvatarId(value: string | null | undefined): AvatarId | null {
  return isAvatarId(value) ? value : null;
}

export type AvatarInput = { ok: true; avatar: AvatarId | null } | { ok: false; message: string };

/** Body von `PUT /api/me/avatar`: `{ avatar: <ID> | null }`. */
export function validateAvatarInput(body: unknown): AvatarInput {
  if (typeof body !== 'object' || body === null || !('avatar' in body)) {
    return { ok: false, message: 'avatar fehlt' };
  }
  const { avatar } = body;
  if (avatar === null) return { ok: true, avatar: null };
  if (!isAvatarId(avatar)) return { ok: false, message: 'Unbekannter Avatar' };
  return { ok: true, avatar };
}

/** Setzt den Avatar eines aktiven Accounts; `false`, wenn es keinen aktiven Account mit dieser ID gibt. */
export async function setUserAvatar(db: Queryable, userId: number, avatar: AvatarId | null): Promise<boolean> {
  const { rowCount } = await db.query('UPDATE users SET avatar = $2 WHERE id = $1 AND deleted_at IS NULL', [
    userId,
    avatar,
  ]);
  return (rowCount ?? 0) > 0;
}
