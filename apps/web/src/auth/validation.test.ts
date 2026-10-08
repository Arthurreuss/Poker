import { describe, expect, it } from 'vitest';
import { checkPassword, checkUsername, validateLogin, validateRegistration } from './validation';

describe('Validierung wie Server', () => {
  it.each([
    ['abc', true],
    ['A_b-9', true],
    ['x'.repeat(20), true],
    ['ab', false],
    ['x'.repeat(21), false],
    ['mit leer', false],
    ['ümlaut', false],
  ])('Benutzername %j gültig: %s', (name, ok) => {
    expect(checkUsername(name) === null).toBe(ok);
  });

  it('Passwort 8–128 Zeichen', () => {
    expect(checkPassword('1234567')).not.toBeNull();
    expect(checkPassword('12345678')).toBeNull();
    expect(checkPassword('x'.repeat(128))).toBeNull();
    expect(checkPassword('x'.repeat(129))).not.toBeNull();
  });

  it('Registrierung prüft Wiederholung', () => {
    expect(validateRegistration('abc', '12345678', '12345678')).toEqual({});
    expect(validateRegistration('abc', '12345678', '12345679')).toEqual({
      passwordRepeat: 'Passwörter stimmen nicht überein',
    });
  });

  it('Login prüft nur die Form', () => {
    expect(validateLogin('', '')).toEqual({ username: 'Benutzername fehlt', password: 'Passwort fehlt' });
    expect(validateLogin('x', 'kurz')).toEqual({});
  });
});
