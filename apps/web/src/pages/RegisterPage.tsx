import { useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  hasErrors,
  validateRegistration,
  type FieldErrors,
} from '../auth/validation';
import { AuthPageLayout, Field, FormAlert, authStyles as styles, errorMessage } from './AuthForm';

export function RegisterPage() {
  const { register } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    const name = username.trim();
    const errors = validateRegistration(name, password, passwordRepeat);
    setFieldErrors(errors);
    if (hasErrors(errors)) return;
    setSubmitting(true);
    try {
      // Der Server loggt direkt ein; RedirectIfAuthenticated leitet weiter.
      await register({ username: name, password });
    } catch (err) {
      setServerError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout title="Registrieren">
      <p className={styles.notice}>Spielgeld – kein Echtgeld. Chips haben keinen Geldwert.</p>
      <form
        noValidate
        className={styles.form}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <FormAlert message={serverError} />
        <Field
          id="username"
          label="Benutzername"
          type="text"
          value={username}
          onChange={setUsername}
          autoComplete="username"
          hint={`${String(USERNAME_MIN)}–${String(USERNAME_MAX)} Zeichen: A–Z, a–z, 0–9, „_“, „-“`}
          error={fieldErrors.username}
        />
        <Field
          id="password"
          label="Passwort"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`${String(PASSWORD_MIN)}–${String(PASSWORD_MAX)} Zeichen`}
          error={fieldErrors.password}
        />
        <Field
          id="password-repeat"
          label="Passwort wiederholen"
          type="password"
          value={passwordRepeat}
          onChange={setPasswordRepeat}
          autoComplete="new-password"
          error={fieldErrors.passwordRepeat}
        />
        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Registrieren …' : 'Konto anlegen'}
        </button>
      </form>
      <p className={styles.switch}>
        Schon registriert?{' '}
        <Link to="/login" state={location.state as unknown}>
          Anmelden
        </Link>
      </p>
    </AuthPageLayout>
  );
}
