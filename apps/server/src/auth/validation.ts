// Eingabeprüfung für Registrierung und Login (D-011), ohne I/O – unit-getestet.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface Credentials {
  username: string;
  password: string;
}

export type ValidationResult = { ok: true; value: Credentials } | { ok: false; message: string };

function readCredentials(body: unknown): Credentials | null {
  if (typeof body !== 'object' || body === null) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  return { username, password };
}

/** `null` = gültig, sonst eine Fehlermeldung für den Client. */
export function checkUsername(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Benutzername muss ${String(USERNAME_MIN)}–${String(USERNAME_MAX)} Zeichen lang sein`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Benutzername darf nur Buchstaben (A–Z), Ziffern, „_“ und „-“ enthalten';
  }
  return null;
}

/** `null` = gültig, sonst eine Fehlermeldung für den Client. */
export function checkPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwort muss mindestens ${String(PASSWORD_MIN)} Zeichen lang sein`;
  if (password.length > PASSWORD_MAX) return `Passwort darf höchstens ${String(PASSWORD_MAX)} Zeichen lang sein`;
  return null;
}

export function validateRegistration(body: unknown): ValidationResult {
  const credentials = readCredentials(body);
  if (credentials === null) return { ok: false, message: 'username und password (Text) sind erforderlich' };
  const error = checkUsername(credentials.username) ?? checkPassword(credentials.password);
  return error === null ? { ok: true, value: credentials } : { ok: false, message: error };
}

/**
 * Login prüft nur die Form (Text, Passwort nicht überlang). Ein Name, der die Regeln verletzt,
 * kann nicht existieren – er führt zum normalen 401, damit die Antwort nichts über Namen verrät.
 */
export function validateLogin(body: unknown): ValidationResult {
  const credentials = readCredentials(body);
  if (credentials === null) return { ok: false, message: 'username und password (Text) sind erforderlich' };
  if (credentials.password.length > PASSWORD_MAX || credentials.username.length > 100) {
    return { ok: false, message: 'Eingabe zu lang' };
  }
  return { ok: true, value: credentials };
}
