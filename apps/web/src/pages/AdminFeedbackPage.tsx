// /admin/feedback (WP-024): Feedback-Liste für Admins, Filter nach Status, Status ändern.
import { useEffect, useState } from 'react';
import {
  ApiError,
  FEEDBACK_STATUSES,
  listFeedback,
  updateFeedbackStatus,
  type FeedbackItem,
  type FeedbackList,
  type FeedbackStatus,
} from '../api';
import { CATEGORY_LABELS } from '../feedback/FeedbackForm';
import { ORIENTATION_LABELS } from '../settings/orientation';
import styles from './Admin.module.css';

export const STATUS_LABELS: Record<FeedbackStatus, string> = { new: 'Neu', read: 'Gelesen', done: 'Erledigt' };

type Filter = FeedbackStatus | 'all';
const FILTERS: Filter[] = [...FEEDBACK_STATUSES, 'all'];

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: FeedbackList };

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Unerwarteter Fehler – bitte erneut versuchen';
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function FeedbackEntry({
  item,
  busy,
  onStatus,
}: {
  item: FeedbackItem;
  busy: boolean;
  onStatus: (status: FeedbackStatus) => void;
}) {
  const context = [
    item.page === null ? null : `Seite ${item.page}`,
    item.tableId === null ? null : `Tisch ${String(item.tableId)}`,
    item.appVersion === null ? null : `Version ${item.appVersion}`,
    item.orientation === null ? null : ORIENTATION_LABELS[item.orientation],
  ].filter((x) => x !== null);
  return (
    <article className={styles.entry} aria-labelledby={`feedback-${String(item.id)}`} data-status={item.status}>
      <header className={styles.entryHead}>
        <span className={styles.badge} data-category={item.category}>
          {CATEGORY_LABELS[item.category]}
        </span>
        <h3 id={`feedback-${String(item.id)}`} className={styles.entryTitle}>
          #{item.id} von {item.username ?? 'gelöschtem Account'}
        </h3>
        <time dateTime={item.createdAt} className={styles.muted}>
          {dateFormat.format(new Date(item.createdAt))}
        </time>
      </header>
      <p className={styles.message}>{item.message}</p>
      {context.length > 0 && <p className={styles.muted}>{context.join(' · ')}</p>}
      {item.userAgent !== null && <p className={styles.userAgent}>{item.userAgent}</p>}
      <label className={styles.statusField}>
        Status
        <select
          aria-label={`Status von #${String(item.id)}`}
          value={item.status}
          disabled={busy}
          onChange={(event) => {
            onStatus(event.target.value as FeedbackStatus);
          }}
        >
          {FEEDBACK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

export function AdminFeedbackPage() {
  const [filter, setFilter] = useState<Filter>('new');
  const [reload, setReload] = useState(0);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listFeedback(filter === 'all' ? null : filter, controller.signal).then(
      (data) => {
        setLoad({ kind: 'ready', data });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: 'error', message: errorText(err) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [filter, reload]);

  const changeStatus = async (item: FeedbackItem, status: FeedbackStatus) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      await updateFeedbackStatus(item.id, status);
      setReload((n) => n + 1);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const counts = load.kind === 'ready' ? load.data.counts : null;
  const countOf = (f: Filter) =>
    counts === null ? null : f === 'all' ? counts.new + counts.read + counts.done : counts[f];

  return (
    <section className={styles.section} aria-labelledby="admin-feedback-title">
      <h2 id="admin-feedback-title" className={styles.title}>
        Feedback
      </h2>
      <div role="group" aria-label="Nach Status filtern" className={styles.filters}>
        {FILTERS.map((f) => {
          const count = countOf(f);
          return (
            <button
              key={f}
              type="button"
              className={styles.filter}
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
              }}
            >
              {f === 'all' ? 'Alle' : STATUS_LABELS[f]}
              {count === null ? '' : ` (${String(count)})`}
            </button>
          );
        })}
      </div>
      {actionError !== null && (
        <p role="alert" className={styles.alert}>
          {actionError}
        </p>
      )}
      {load.kind === 'loading' && <p role="status">Laden …</p>}
      {load.kind === 'error' && (
        <p role="alert" className={styles.alert}>
          {load.message}
        </p>
      )}
      {load.kind === 'ready' &&
        (load.data.feedback.length === 0 ? (
          <p className={styles.muted}>
            Kein Feedback{filter === 'all' ? '' : ` mit Status „${STATUS_LABELS[filter]}“`}.
          </p>
        ) : (
          <div className={styles.entries}>
            {load.data.feedback.map((item) => (
              <FeedbackEntry
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onStatus={(status) => {
                  void changeStatus(item, status);
                }}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
