import { useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { hasErrors, validateLogin, type FieldErrors } from '../auth/validation';
import { AuthPageLayout, Field, FormAlert, authStyles as styles, errorMessage } from './AuthForm';

export function LoginPage() {
  const { login } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    const errors = validateLogin(username.trim(), password);
    setFieldErrors(errors);
    if (hasErrors(errors)) return;
    setSubmitting(true);
    try {
      // Bei Erfolg leitet RedirectIfAuthenticated zur Zielseite weiter.
      await login({ username: username.trim(), password });
    } catch (err) {
      setServerError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout title="Anmelden">
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
          error={fieldErrors.username}
        />
        <Field
          id="password"
          label="Passwort"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
        />
        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Anmelden …' : 'Anmelden'}
        </button>
      </form>
      <p className={styles.switch}>
        Noch kein Konto?{' '}
        <Link to="/register" state={location.state as unknown}>
          Registrieren
        </Link>
      </p>
    </AuthPageLayout>
  );
}
