// Allgemeiner Admin-Guard (WP-028, D-029): Jede Anfrage auf `/api/admin` oder `/api/admin/*` braucht eine gültige
// Session eines Admins – ohne Session 401, ohne Admin-Flag 403. Der Hook hängt an der Wurzel der App und greift
// damit für alle Plugins und auch für unbekannte Pfade (kein Ausspähen von Admin-Routen über 404).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getUserFromCookieHeader, type AuthUser } from '../auth/session';
import type { Queryable } from '../db';

export const ADMIN_API_PREFIX = '/api/admin';

export interface AdminErrorResponse {
  error: 'unauthorized' | 'forbidden';
  message: string;
}

export const ADMIN_UNAUTHORIZED: AdminErrorResponse = { error: 'unauthorized', message: 'Nicht angemeldet' };
export const ADMIN_FORBIDDEN: AdminErrorResponse = { error: 'forbidden', message: 'Nur für Admins' };

declare module 'fastify' {
  interface FastifyRequest {
    /** Eingeloggter Admin – gesetzt vom Admin-Guard für `/api/admin/*`, sonst `null`. */
    adminUser: AuthUser | null;
  }
}

/** `true` für `/api/admin` und alles darunter (Pfad ohne Query). */
export function isAdminPath(url: string): boolean {
  const path = url.split('?', 1)[0] ?? '';
  return path === ADMIN_API_PREFIX || path.startsWith(`${ADMIN_API_PREFIX}/`);
}

/** Registriert den Guard an der Wurzel-Instanz – vor allen Routen-Plugins aufrufen. */
export function registerAdminGuard(app: FastifyInstance, db: Queryable): void {
  app.decorateRequest('adminUser', null);
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url;
    if (!isAdminPath(request.url) && !(route !== undefined && isAdminPath(route))) return;
    const user = await getUserFromCookieHeader(db, request.headers.cookie);
    if (user === null) return reply.code(401).send(ADMIN_UNAUTHORIZED);
    if (!user.isAdmin) return reply.code(403).send(ADMIN_FORBIDDEN);
    request.adminUser = user;
  });
}

/** Admin der Anfrage in Admin-Routen; wirft, falls der Guard nicht gelaufen ist (Programmierfehler). */
export function adminOf(request: FastifyRequest): AuthUser {
  if (request.adminUser === null) throw new Error('Admin-Guard nicht aktiv');
  return request.adminUser;
}
