import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from './config';
import { hashPassword, verifyDummyPassword, verifyPassword } from './password';
import { clientIp } from './routes';
import { SESSION_COOKIE, generateSessionToken, hashSessionToken, isWellFormedToken, readSessionToken } from './session';
import { checkPassword, checkUsername, validateLogin, validateRegistration } from './validation';

describe('Validierung', () => {
  it.each(['abc', 'A_b-9', 'x'.repeat(20), 'Arthur'])('akzeptiert Benutzername %s', (name) => {
    expect(checkUsername(name)).toBeNull();
  });

  it.each(['ab', 'x'.repeat(21), 'mit leer', 'ümlaut', 'a.b', 'a@b', '', 'abc\n'])(
    'lehnt Benutzername %j ab',
    (name) => {
      expect(checkUsername(name)).toEqual(expect.any(String));
    },
  );

  it('prüft die Passwortlänge (8–128)', () => {
    expect(checkPassword('1234567')).toMatch(/mindestens 8/);
    expect(checkPassword('12345678')).toBeNull();
    expect(checkPassword('x'.repeat(128))).toBeNull();
    expect(checkPassword('x'.repeat(129))).toMatch(/höchstens 128/);
  });

  it('validateRegistration verlangt Text-Felder und prüft beide Regeln', () => {
    expect(validateRegistration({ username: 'alice', password: 'geheim123' })).toEqual({
      ok: true,
      value: { username: 'alice', password: 'geheim123' },
    });
    for (const body of [null, 'x', {}, { username: 'alice' }, { username: 1, password: 'geheim123' }]) {
      expect(validateRegistration(body).ok).toBe(false);
    }
    expect(validateRegistration({ username: 'al', password: 'geheim123' }).ok).toBe(false);
    expect(validateRegistration({ username: 'alice', password: 'kurz' }).ok).toBe(false);
  });

  it('validateLogin prüft nur die Form, nicht die Namensregeln', () => {
    expect(validateLogin({ username: 'x', password: 'y' }).ok).toBe(true);
    expect(validateLogin({ username: 'alice' }).ok).toBe(false);
    expect(validateLogin({ username: 'alice', password: 'x'.repeat(129) }).ok).toBe(false);
  });
});

describe('Session-Token', () => {
  it('ist 32 Zufallsbytes als base64url (43 Zeichen) und jedes Mal anders', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(isWellFormedToken('kurz')).toBe(false);
    expect(isWellFormedToken(`${a}=`)).toBe(false);
  });

  it('wird als SHA-256 (32 Byte) gespeichert', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toHaveLength(32);
    expect(hash.equals(createHash('sha256').update(token).digest())).toBe(true);
  });

  it('readSessionToken liest das Cookie aus einem rohen Cookie-Header', () => {
    expect(readSessionToken(undefined)).toBeUndefined();
    expect(readSessionToken('')).toBeUndefined();
    expect(readSessionToken('foo=bar')).toBeUndefined();
    expect(readSessionToken(`foo=bar; ${SESSION_COOKIE}=abc_-1; x=y`)).toBe('abc_-1');
    expect(readSessionToken(`${SESSION_COOKIE}=abc;other=1`)).toBe('abc');
    expect(readSessionToken(`${SESSION_COOKIE}="abc"`)).toBe('abc');
    expect(readSessionToken(`x${SESSION_COOKIE}=abc`)).toBeUndefined();
  });
});

describe('Passwort-Hashing', () => {
  it('erzeugt argon2id mit den OWASP-Parametern und verifiziert', async () => {
    const hash = await hashPassword('geheim123');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('geheim123');
    expect(await verifyPassword(hash, 'geheim123')).toBe(true);
    expect(await verifyPassword(hash, 'geheim124')).toBe(false);
  });

  it('wirft nicht bei kaputtem Hash und der Dummy-Vergleich ist immer false', async () => {
    expect(await verifyPassword('kein-hash', 'geheim123')).toBe(false);
    expect(await verifyDummyPassword('dummy-password-for-timing')).toBe(false);
  });
});

describe('loadAuthConfig', () => {
  it('nutzt Defaults: 30 Tage, 10 Versuche pro Minute, dev ohne Secure und ohne CF-Header', () => {
    expect(loadAuthConfig({})).toEqual({
      secureCookies: false,
      trustCfConnectingIp: false,
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      rateLimit: { max: 10, windowMs: 60_000 },
    });
  });

  it('setzt Secure und CF-Connecting-IP nur in production', () => {
    const config = loadAuthConfig({ NODE_ENV: 'production' });
    expect(config.secureCookies).toBe(true);
    expect(config.trustCfConnectingIp).toBe(true);
  });

  it('liest Rate-Limit und Session-Dauer aus der Umgebung, 0 schaltet das Rate-Limit ab', () => {
    const config = loadAuthConfig({
      AUTH_RATE_LIMIT_MAX: '3',
      AUTH_RATE_LIMIT_WINDOW_SECONDS: '5',
      SESSION_TTL_DAYS: '1',
    });
    expect(config.rateLimit).toEqual({ max: 3, windowMs: 5000 });
    expect(config.sessionTtlMs).toBe(86_400_000);
    expect(loadAuthConfig({ AUTH_RATE_LIMIT_MAX: '0' }).rateLimit).toBeNull();
  });

  it.each(['AUTH_RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_WINDOW_SECONDS', 'SESSION_TTL_DAYS'])(
    'wirft bei ungültigem %s',
    (name) => {
      expect(() => loadAuthConfig({ [name]: '-1' })).toThrow(name);
    },
  );
});

describe('clientIp', () => {
  const request = (headers: Record<string, string>) => ({ ip: '10.0.0.1', headers }) as unknown as FastifyRequest;

  it('nutzt CF-Connecting-IP nur, wenn vertraut (prod)', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.7' }), true)).toBe('203.0.113.7');
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.7' }), false)).toBe('10.0.0.1');
    expect(clientIp(request({}), true)).toBe('10.0.0.1');
  });
});
