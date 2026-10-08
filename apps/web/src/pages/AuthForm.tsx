// Gemeinsame Bausteine für Login- und Registrierungsseite.
import type { ReactNode } from 'react';
import { ApiError } from '../api';
import { LegalFooter } from '../legal/LegalFooter';
import { cx } from '../styles/cx';
import styles from './AuthPage.module.css';

export function AuthPageLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={cx(styles.page, 'safe-area')}>
      <main className={styles.card}>
        <div className={styles.brand}>
          <img src="/icons/icon.svg" alt="" width={56} height={56} />
          <span>Poker</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: 'text' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string | undefined;
  hint?: string;
}

export function Field({ id, label, type, value, onChange, autoComplete, error, hint }: FieldProps) {
  const describedBy = [hint === undefined ? null : `${id}-hint`, error === undefined ? null : `${id}-error`]
    .filter((x) => x !== null)
    .join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {hint !== undefined && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span id={`${id}-error`} className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Text für die Fehlermeldung im Formular; der Server liefert deutsche Meldungen (`message`). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Unerwarteter Fehler – bitte erneut versuchen';
}

export function FormAlert({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className={styles.alert}>
      {message}
    </p>
  );
}

export { styles as authStyles };
