// Passwort-Hashing mit argon2id (D-011). `@node-rs/argon2` hat Prebuilds inkl. musl (node:22-alpine)
// und braucht keine Install-Skripte (das Dev-Image installiert mit `--ignore-scripts`).
import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * OWASP-Empfehlung für argon2id: 19 MiB, 2 Durchläufe, 1 Thread (~20–40 ms pro Hash).
 * `algorithm` fehlt bewusst: Standard der Bibliothek ist argon2id, und ihr `const enum` ist mit
 * `isolatedModules` nicht als Wert nutzbar. Ein Test prüft das `$argon2id$`-Präfix.
 */
export const ARGON2_OPTIONS: Options = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** `false` auch bei kaputtem Hash-String – nie werfen, damit Login-Antworten einheitlich bleiben. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Prüft gegen einen festen Dummy-Hash (gleiche Parameter) und liefert immer `false`.
 * Für Logins mit unbekanntem Namen, damit die Laufzeit der eines falschen Passworts ähnelt.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
