// Fetch-Wrapper für die eigene API: nur relative Pfade, eine Origin (D-014).

/** Fehlercodes des Servers (`{ error, message }`) plus clientseitige Codes. */
export type ApiErrorCode =
  | 'invalid_request'
  | 'username_taken'
  | 'invalid_credentials'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'internal'
  /** Server nicht erreichbar (fetch wirft). */
  | 'network'
  /** Antwort ohne erkennbaren Fehlercode (z. B. Proxy-Fehlerseite). */
  | 'unknown';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | (string & {});

  constructor(status: number, code: ApiErrorCode | (string & {}), message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Wird als JSON gesendet. */
  body?: unknown;
  signal?: AbortSignal;
}

function isErrorBody(value: unknown): value is { error: string; message: string } {
  if (typeof value !== 'object' || value === null) return false;
  const { error, message } = value as Record<string, unknown>;
  return typeof error === 'string' && typeof message === 'string';
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Ruft `path` (muss mit `/` beginnen, z. B. `/api/me`) auf und liefert den JSON-Body.
 * Antworten ≥ 400 werden zu `ApiError` mit Code und Text des Servers.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`apiRequest braucht einen relativen Pfad (D-014): ${path}`);
  }
  const { method = 'GET', body, signal } = options;
  const init: RequestInit = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (signal !== undefined) init.signal = signal;

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Server nicht erreichbar – bitte Verbindung prüfen');
  }

  const data = await readJson(res);
  if (!res.ok) {
    if (isErrorBody(data)) throw new ApiError(res.status, data.error, data.message);
    throw new ApiError(res.status, 'unknown', `Unerwartete Antwort vom Server (HTTP ${String(res.status)})`);
  }
  return data as T;
}
