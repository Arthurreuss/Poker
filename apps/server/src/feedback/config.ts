// Feedback-Konfiguration aus Umgebungsvariablen (D-014). Ablauf: docs/ARCHITECTURE.md, „Feedback“.
import type { Env } from '../config';

export interface FeedbackConfig {
  /** `null` = kein Rate-Limit (`FEEDBACK_RATE_LIMIT_MAX=0`). Gezählt wird pro User, nicht pro IP. */
  rateLimit: { max: number; windowMs: number } | null;
}

function nonNegativeInt(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`Umgebungsvariable ${name} ist ungültig: ${raw}`);
  return value;
}

export function loadFeedbackConfig(env: Env): FeedbackConfig {
  const max = nonNegativeInt(env, 'FEEDBACK_RATE_LIMIT_MAX', 5, 0);
  const windowSeconds = nonNegativeInt(env, 'FEEDBACK_RATE_LIMIT_WINDOW_SECONDS', 3600, 1);
  return { rateLimit: max === 0 ? null : { max, windowMs: windowSeconds * 1000 } };
}
