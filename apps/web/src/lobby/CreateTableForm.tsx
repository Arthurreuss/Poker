// Formular „Tisch erstellen“ (WP-015). Prüft clientseitig mit den Server-Regeln (`tableSettingsForm.ts`).
import { useId, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { TableSettings } from '@poker/engine/protocol';
import {
  BLIND_LEVEL_OPTIONS,
  defaultCreateTableValues,
  formatBlinds,
  validateCreateTableForm,
  type CreateTableErrors,
  type CreateTableField,
  type CreateTableFormValues,
} from './tableSettingsForm';
import styles from './Lobby.module.css';

interface Props {
  username?: string | undefined;
  /** Sendet `table.create`; wirft bei Fehlern (Meldung wird angezeigt). */
  onSubmit: (settings: TableSettings) => Promise<void>;
  onCancel?: () => void;
  /** Keine Verbindung → Absenden gesperrt. */
  disabled?: boolean;
}

export function CreateTableForm({ username, onSubmit, onCancel, disabled = false }: Props) {
  const id = useId();
  const [values, setValues] = useState<CreateTableFormValues>(() => defaultCreateTableValues(username));
  const [errors, setErrors] = useState<CreateTableErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends CreateTableField>(field: K, value: CreateTableFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (e[field] === undefined && e.form === undefined) return e;
      return Object.fromEntries(Object.entries(e).filter(([key]) => key !== field && key !== 'form'));
    });
  };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    setServerError(null);
    const result = validateCreateTableForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(result.settings);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Tisch konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  }

  const fieldProps = (field: CreateTableField) => ({
    id: `${id}-${field}`,
    name: field,
    'aria-invalid': errors[field] !== undefined,
    'aria-describedby': errors[field] === undefined ? undefined : `${id}-${field}-error`,
  });
  const error = (field: CreateTableField) =>
    errors[field] === undefined ? null : (
      <span id={`${id}-${field}-error`} className={styles.fieldError}>
        {errors[field]}
      </span>
    );
  const numberInput = (field: CreateTableField, label: string, hint?: string): ReactNode => (
    <div className={styles.field}>
      <label htmlFor={`${id}-${field}`}>{label}</label>
      <input
        {...fieldProps(field)}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={values[field] as string}
        onChange={(e) => {
          set(field, e.target.value);
        }}
      />
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      {error(field)}
    </div>
  );

  const alert = errors.form ?? serverError;

  return (
    <form className={styles.form} noValidate onSubmit={(e) => void submit(e)} aria-label="Tisch erstellen">
      <h2 className={styles.sectionTitle}>Tisch erstellen</h2>
      <div className={styles.field}>
        <label htmlFor={`${id}-name`}>Tischname</label>
        <input
          {...fieldProps('name')}
          type="text"
          autoComplete="off"
          maxLength={60}
          value={values.name}
          onChange={(e) => {
            set('name', e.target.value);
          }}
        />
        {error('name')}
      </div>

      <div className={styles.grid}>
        {numberInput('startingStack', 'Startstack', 'Chips pro Spieler')}
        <div className={styles.field}>
          <label htmlFor={`${id}-maxSeats`}>Plätze</label>
          <select
            {...fieldProps('maxSeats')}
            value={values.maxSeats}
            onChange={(e) => {
              set('maxSeats', e.target.value);
            }}
          >
            {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
          {error('maxSeats')}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-blindLevel`}>Start-Blinds</label>
          <select
            {...fieldProps('blindLevel')}
            value={values.blindLevel}
            onChange={(e) => {
              set('blindLevel', e.target.value);
            }}
          >
            {BLIND_LEVEL_OPTIONS.map((level, i) => (
              <option key={level.bigBlind} value={String(i)}>
                {formatBlinds(level)}
              </option>
            ))}
          </select>
          <span className={styles.hint}>Small/Big Blind, keine Antes</span>
          {error('blindLevel')}
        </div>
      </div>

      <div className={styles.grid}>
        <fieldset className={styles.choice}>
          <legend>Blind-Erhöhung</legend>
          <label className={styles.option}>
            <input
              type="radio"
              name="blindMode"
              checked={values.blindMode === 'increasing'}
              onChange={() => {
                set('blindMode', 'increasing');
              }}
            />
            Steigend
          </label>
          <label className={styles.option}>
            <input
              type="radio"
              name="blindMode"
              checked={values.blindMode === 'fixed'}
              onChange={() => {
                set('blindMode', 'fixed');
              }}
            />
            Fest
          </label>
        </fieldset>
        {values.blindMode === 'increasing' && numberInput('levelMinutes', 'Minuten pro Level')}
      </div>

      <div className={styles.grid}>
        {numberInput('turnTimeSeconds', 'Zugzeit (Sekunden)', '10–120')}
        {numberInput('timeBankSeconds', 'Zeitbank (Sekunden)', '0–300, pro Spieler und Runde')}
      </div>

      <fieldset className={styles.choice}>
        <legend>Sichtbarkeit</legend>
        <label className={styles.option}>
          <input
            type="radio"
            name="visibility"
            checked={values.isPublic}
            onChange={() => {
              set('isPublic', true);
            }}
          />
          Öffentlich (in der Lobby)
        </label>
        <label className={styles.option}>
          <input
            type="radio"
            name="visibility"
            checked={!values.isPublic}
            onChange={() => {
              set('isPublic', false);
            }}
          />
          Privat (nur per Einladungslink)
        </label>
      </fieldset>

      {alert !== null && (
        <p role="alert" className={styles.alert}>
          {alert}
        </p>
      )}

      <div className={styles.actions}>
        {onCancel !== undefined && (
          <button type="button" className={styles.secondary} onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="submit" className={styles.primary} disabled={busy || disabled}>
          {busy ? 'Wird erstellt …' : 'Tisch erstellen'}
        </button>
      </div>
    </form>
  );
}
