// `PUT /api/me/avatar` (WP-032): eigenen Avatar wählen oder entfernen. Eigenes Plugin neben dem Auth-Plugin;
// die Session wird wie bei den Statistiken aus dem rohen Cookie-Header gelesen. Format: ARCHITECTURE.md „Auth“.
import type { AvatarId } from '@poker/engine/protocol';
import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { getUserFromCookieHeader, type AuthUser } from '../auth/session';
import type { Queryable } from '../db';
import { setUserAvatar, validateAvatarInput } from './avatar';

export interface AvatarPluginOptions {
  db: Queryable;
  /** Nach erfolgreicher Änderung, z. B. um die Sitze am Tisch zu aktualisieren. */
  onAvatarChanged?: (userId: number, avatar: AvatarId | null) => void;
}

export interface AvatarErrorResponse {
  error: 'unauthorized' | 'invalid_request' | 'internal';
  message: string;
}

export const avatarRoutes: FastifyPluginAsync<AvatarPluginOptions> = (app, { db, onAvatarChanged }) => {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'invalid_request', message: err.message } satisfies AvatarErrorResponse);
    }
    request.log.error({ err }, 'Avatar: unerwarteter Fehler');
    return reply.code(500).send({ error: 'internal', message: 'Interner Fehler' } satisfies AvatarErrorResponse);
  });

  app.put('/api/me/avatar', async (request, reply) => {
    const user = await getUserFromCookieHeader(db, request.headers.cookie);
    if (user === null) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Nicht angemeldet' } satisfies AvatarErrorResponse);
    }
    const input = validateAvatarInput(request.body);
    if (!input.ok) {
      return reply.code(400).send({ error: 'invalid_request', message: input.message } satisfies AvatarErrorResponse);
    }
    if (!(await setUserAvatar(db, user.id, input.avatar))) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Nicht angemeldet' } satisfies AvatarErrorResponse);
    }
    onAvatarChanged?.(user.id, input.avatar);
    return { user: { ...user, avatar: input.avatar } satisfies AuthUser };
  });
  return Promise.resolve();
};
