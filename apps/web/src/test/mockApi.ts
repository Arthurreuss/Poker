// Test-Helfer: ersetzt `fetch` durch feste Antworten je "METHODE /pfad".
import { vi } from 'vitest';

export type MockResponse = { status: number; body?: unknown } | Error;
export type MockRoutes = Record<string, MockResponse | ((init: RequestInit | undefined) => MockResponse)>;

export const ADMIN = { id: 1, username: 'arthur', isAdmin: true };
export const PLAYER = { id: 2, username: 'spieler_1', isAdmin: false };

export function json(status: number, body?: unknown): MockResponse {
  return { status, body };
}

export function unauthorized(): MockResponse {
  return json(401, { error: 'unauthorized', message: 'Nicht angemeldet' });
}

/** Installiert den Mock und gibt die `vi.fn` zurück (Aufrufe prüfbar). */
export function mockApi(routes: MockRoutes) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? 'GET'} ${url}`;
    const route = routes[key] ?? (key === 'GET /api/health' ? json(200, { status: 'ok', db: 'ok' }) : undefined);
    if (route === undefined) return Promise.reject(new Error(`Unerwarteter Aufruf: ${key}`));
    const result = typeof route === 'function' ? route(init) : route;
    if (result instanceof Error) return Promise.reject(result);
    const body = result.body === undefined ? null : JSON.stringify(result.body);
    return Promise.resolve(
      new Response(body, { status: result.status, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Body eines Aufrufs als Objekt. */
export function requestBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
}
