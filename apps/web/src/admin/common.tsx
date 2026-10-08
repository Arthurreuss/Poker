// Gemeinsame Bausteine des Admin-Dashboards (WP-029): Laden mit Abbruch, Fehlertexte, Formate, Bestätigungsdialog.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api';
import styles from './Dashboard.module.css';

export type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: T };

export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Unerwarteter Fehler – bitte erneut versuchen';
}

/**
 * Lädt `fetcher` bei jeder Änderung von `key` und bei `reload()`; ältere Anfragen werden abgebrochen. Beim Neuladen
 * bleiben die alten Daten sichtbar (kein Flackern), Fehler ersetzen sie.
 */
export function useLoad<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string) {
  const [load, setLoad] = useState<Load<T>>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  // Vor dem Lade-Effekt (gleiche Reihenfolge), damit immer der aktuelle Fetcher läuft.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetcherRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', data });
      },
      (err: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: errorText(err) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, tick]);

  const reload = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  return { load, reload };
}

export function LoadState({ load }: { load: Load<unknown> }) {
  if (load.kind === 'loading') return <p role="status">Laden …</p>;
  if (load.kind === 'error') {
    return (
      <p role="alert" className={styles.alert}>
        {load.message}
      </p>
    );
  }
  return null;
}

export const dateTimeFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
export const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

/** „3 T 4 Std“, „5 Std 12 Min“, „42 Min“. */
export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${String(d)} T ${String(h)} Std`;
  if (h > 0) return `${String(h)} Std ${String(m)} Min`;
  return `${String(m)} Min`;
}

export interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Roter Bestätigungsknopf für zerstörerische Aktionen. */
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modaler Bestätigungsdialog (Portal in `document.body`): Escape/Hintergrund = Abbrechen, Fokus auf „Abbrechen“. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal onClose={busy ? () => undefined : onCancel}>
      {(titleId, initialFocus) => (
        <>
          <h2 id={titleId} className={styles.dialogTitle}>
            {title}
          </h2>
          {children}
          {error !== null && (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button ref={initialFocus} type="button" className={styles.button} disabled={busy} onClick={onCancel}>
              Abbrechen
            </button>
            <button
              type="button"
              className={danger ? styles.danger : styles.primary}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? 'Bitte warten …' : confirmLabel}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Grundgerüst eines modalen Dialogs; `children` bekommt die Titel-ID und eine Ref für das erste Fokusziel. */
export function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: (titleId: string, initialFocus: RefObject<HTMLButtonElement | null>) => ReactNode;
}) {
  const titleId = useId();
  const initialFocus = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocus.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {children(titleId, initialFocus)}
      </div>
    </div>,
    document.body,
  );
}
