// Feedback-Formular (WP-024): Kategorie, Text (max. 2000 Zeichen mit Zähler), Bestätigung nach dem Senden.
import { useId, useState, type SyntheticEvent } from 'react';
import { ApiError, sendFeedback, type FeedbackCategory } from '../api';
import { useOrientationPreference } from '../settings/orientation';
import { buildFeedbackContext, type FeedbackContextOptions } from './context';
import styles from './Feedback.module.css';

export const FEEDBACK_MAX_LENGTH = 2000;

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  idea: 'Idee',
  other: 'Sonstiges',
};
const CATEGORIES = Object.keys(CATEGORY_LABELS) as FeedbackCategory[];

export interface FeedbackFormProps extends FeedbackContextOptions {
  /** „Schließen“/„Abbrechen“ bzw. nach der Bestätigung. */
  onClose: () => void;
  /** Id für die Überschrift (Dialog-Beschriftung). */
  titleId?: string;
}

type State = { kind: 'editing'; error: string | null } | { kind: 'sending' } | { kind: 'sent' };

export function FeedbackForm({ onClose, titleId, page, tableId }: FeedbackFormProps) {
  const [orientation] = useOrientationPreference();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<State>({ kind: 'editing', error: null });
  const id = useId();
  const headingId = titleId ?? `${id}-title`;
  const counterId = `${id}-counter`;

  const trimmed = message.trim();
  const canSend = category !== null && trimmed !== '' && message.length <= FEEDBACK_MAX_LENGTH;

  const onSubmit = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!canSend || state.kind === 'sending') return;
    setState({ kind: 'sending' });
    try {
      const context = buildFeedbackContext(
        { ...(page === undefined ? {} : { page }), ...(tableId === undefined ? {} : { tableId }) },
        orientation,
      );
      await sendFeedback({ category, message: trimmed, ...context });
      setState({ kind: 'sent' });
    } catch (err) {
      setState({
        kind: 'editing',
        error: err instanceof ApiError ? err.message : 'Unerwarteter Fehler – bitte erneut versuchen',
      });
    }
  };

  if (state.kind === 'sent') {
    return (
      <div className={styles.form}>
        <h2 id={headingId} className={styles.title}>
          Danke!
        </h2>
        <p role="status">Dein Feedback ist angekommen.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onClose} autoFocus>
            Schließen
          </button>
        </div>
      </div>
    );
  }

  const error = state.kind === 'editing' ? state.error : null;
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      <h2 id={headingId} className={styles.title}>
        Feedback senden
      </h2>
      <fieldset className={styles.categories}>
        <legend className={styles.label}>Worum geht es?</legend>
        {CATEGORIES.map((value) => (
          <label key={value} className={styles.category} data-checked={category === value}>
            <input
              type="radio"
              name={`${id}-category`}
              value={value}
              checked={category === value}
              onChange={() => {
                setCategory(value);
              }}
            />
            {CATEGORY_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <div className={styles.field}>
        <label htmlFor={`${id}-message`} className={styles.label}>
          Deine Nachricht
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          maxLength={FEEDBACK_MAX_LENGTH}
          rows={6}
          aria-describedby={counterId}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
        />
        <span id={counterId} className={styles.counter} aria-live="polite">
          {message.length} / {FEEDBACK_MAX_LENGTH}
        </span>
      </div>
      <p className={styles.hint}>Seite, App-Version, Gerät und Ausrichtung werden automatisch mitgeschickt.</p>
      {error !== null && (
        <p role="alert" className={styles.alert}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onClose}>
          Abbrechen
        </button>
        <button type="submit" className={styles.primary} disabled={!canSend || state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Senden …' : 'Senden'}
        </button>
      </div>
    </form>
  );
}
