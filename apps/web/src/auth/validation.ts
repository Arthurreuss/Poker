// Eingabeprüfung im Client – dieselben Regeln wie der Server (apps/server/src/auth/validation.ts, D-011).
// Der Server prüft trotzdem selbst; hier geht es nur um schnelle Rückmeldung im Formular.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface FieldErrors {
  username?: string;
  password?: string;
  passwordRepeat?: string;
}

/** `null` = gültig, sonst eine Fehlermeldung. */
export function checkUsername(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `Benutzername muss ${String(USERNAME_MIN)}–${String(USERNAME_MAX)} Zeichen lang sein`;
  }
  if (!USERNAME_PATTERN.test(username)) {
    return 'Benutzername darf nur Buchstaben (A–Z), Ziffern, „_“ und „-“ enthalten';
  }
  return null;
}

/** `null` = gültig, sonst eine Fehlermeldung. */
export function checkPassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwort muss mindestens ${String(PASSWORD_MIN)} Zeichen lang sein`;
  if (password.length > PASSWORD_MAX) return `Passwort darf höchstens ${String(PASSWORD_MAX)} Zeichen lang sein`;
  return null;
}

export function validateRegistration(username: string, password: string, passwordRepeat: string): FieldErrors {
  const errors: FieldErrors = {};
  const usernameError = checkUsername(username);
  if (usernameError !== null) errors.username = usernameError;
  const passwordError = checkPassword(password);
  if (passwordError !== null) errors.password = passwordError;
  else if (password !== passwordRepeat) errors.passwordRepeat = 'Passwörter stimmen nicht überein';
  return errors;
}

/**
 * Login prüft wie der Server nur die Form: Felder gefüllt, Passwort nicht überlang.
 * Ein Name, der die Regeln verletzt, führt beim Server einfach zu 401.
 */
export function validateLogin(username: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (username === '') errors.username = 'Benutzername fehlt';
  if (password === '') errors.password = 'Passwort fehlt';
  else if (password.length > PASSWORD_MAX) {
    errors.password = `Passwort darf höchstens ${String(PASSWORD_MAX)} Zeichen lang sein`;
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
