// Einstellungen → „Konto löschen“ (WP-022, DSGVO). Bestätigung per Passwort; danach ist man abgemeldet.
// Was serverseitig passiert: docs/ARCHITECTURE.md, „Auth“ → „Konto löschen“.
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { DATENSCHUTZ_PATH } from '../legal/LegalFooter';
import { errorMessage } from '../pages/AuthForm';
import pageStyles from '../pages/Page.module.css';
import styles from './DeleteAccount.module.css';

export function DeleteAccount() {
  const { deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password === '') {
      setError('Bitte zur Bestätigung dein Passwort eingeben');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Bei Erfolg ist man abgemeldet; RequireAuth leitet zur Login-Seite (mit Bestätigung).
      await deleteAccount(password);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <section className={pageStyles.panel} aria-labelledby="delete-account-title">
      <h2 id="delete-account-title" className={styles.title}>
        Konto löschen
      </h2>
      <p className={pageStyles.muted}>
        Benutzername und Passwort werden entfernt, du wirst überall abgemeldet. Deine bisherigen Runden bleiben für die
        anderen Spieler erhalten, erscheinen aber nur noch als „Gelöschter Spieler“. Das lässt sich nicht rückgängig
        machen. Details: <Link to={DATENSCHUTZ_PATH}>Datenschutz</Link>.
      </p>
      {open ? (
        <form
          noValidate
          className={styles.form}
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="delete-password">Passwort zur Bestätigung</label>
          <input
            id="delete-password"
            name="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'delete-error'}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          {error !== null && (
            <p id="delete-error" role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancel}
              disabled={submitting}
              onClick={() => {
                setOpen(false);
                setPassword('');
                setError(null);
              }}
            >
              Abbrechen
            </button>
            <button type="submit" className={styles.danger} disabled={submitting}>
              {submitting ? 'Lösche …' : 'Konto endgültig löschen'}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className={styles.dangerOutline}
          onClick={() => {
            setOpen(true);
          }}
        >
          Konto löschen …
        </button>
      )}
    </section>
  );
}
