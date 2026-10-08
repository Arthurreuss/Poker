// Auth-Konfiguration aus Umgebungsvariablen (D-014: nichts hart im Code). Ablauf: docs/ARCHITECTURE.md, „Auth“.
import type { Env } from '../config';

export interface RateLimitConfig {
  /** Anfragen pro Fenster und Client-IP, je Route (`/api/login`, `/api/register`). */
  max: number;
  windowMs: number;
}

export interface AuthConfig {
  /** Session-Cookie mit `Secure` (nur `NODE_ENV=production`, D-014). */
  secureCookies: boolean;
  /** Client-IP aus `CF-Connecting-IP` statt `request.ip` (nur `NODE_ENV=production`, D-014). */
  trustCfConnectingIp: boolean;
  sessionTtlMs: number;
  /** `null` = kein Rate-Limit (`AUTH_RATE_LIMIT_MAX=0`). */
  rateLimit: RateLimitConfig | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function positiveInt(env: Env, name: string, fallback: number, allowZero = false): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`Umgebungsvariable ${name} ist ungültig: ${raw}`);
  }
  return value;
}

export function loadAuthConfig(env: Env): AuthConfig {
  const production = env['NODE_ENV'] === 'production';
  const max = positiveInt(env, 'AUTH_RATE_LIMIT_MAX', 10, true);
  return {
    secureCookies: production,
    trustCfConnectingIp: production,
    sessionTtlMs: positiveInt(env, 'SESSION_TTL_DAYS', 30) * DAY_MS,
    rateLimit: max === 0 ? null : { max, windowMs: positiveInt(env, 'AUTH_RATE_LIMIT_WINDOW_SECONDS', 60) * 1000 },
  };
}
