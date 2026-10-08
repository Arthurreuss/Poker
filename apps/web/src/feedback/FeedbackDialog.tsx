// Feedback-Dialog (WP-024) und wiederverwendbare Einstiege: `useFeedbackDialog` (z. B. Tisch-Menü) und
// `FeedbackButton` (App-Shell). Der Dialog wird per Portal in `document.body` gerendert, damit er unabhängig
// davon offen bleibt, ob z. B. ein Menü, aus dem er geöffnet wurde, sich schließt.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { FeedbackContextOptions } from './context';
import styles from './Feedback.module.css';
import { FeedbackForm } from './FeedbackForm';

export interface FeedbackDialogProps extends FeedbackContextOptions {
  open: boolean;
  onClose: () => void;
}

/** Modaler Dialog mit dem Feedback-Formular; schließt bei Escape und Klick auf den Hintergrund. */
export function FeedbackDialog({ open, onClose, page, tableId }: FeedbackDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="feedback-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <FeedbackForm
          onClose={onClose}
          titleId={titleId}
          {...(page === undefined ? {} : { page })}
          {...(tableId === undefined ? {} : { tableId })}
        />
      </div>
    </div>,
    document.body,
  );
}

export interface FeedbackDialogHandle {
  /** Öffnet das Formular (stabile Referenz, z. B. für `onClick` eines Menüeintrags). */
  open: () => void;
  close: () => void;
  isOpen: boolean;
  /** Muss irgendwo gerendert werden – am besten außerhalb eines Menüs, das sich beim Klick schließt. */
  dialog: ReactNode;
}

/**
 * Feedback-Formular aus beliebigen Komponenten öffnen. Beispiel Tisch-Menü (WP-018):
 * `const feedback = useFeedbackDialog({ tableId });` → Menüeintrag `onClick={feedback.open}`,
 * `{feedback.dialog}` neben dem Menü rendern.
 */
export function useFeedbackDialog(options: FeedbackContextOptions = {}): FeedbackDialogHandle {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => {
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);
  const { page, tableId } = options;
  const dialog = useMemo(
    () => (
      <FeedbackDialog
        open={isOpen}
        onClose={close}
        {...(page === undefined ? {} : { page })}
        {...(tableId === undefined ? {} : { tableId })}
      />
    ),
    [isOpen, close, page, tableId],
  );
  return { open, close, isOpen, dialog };
}

export interface FeedbackButtonProps extends FeedbackContextOptions {
  className?: string;
  children?: ReactNode;
}

/** Knopf „Feedback“, der den Dialog öffnet (App-Shell; auch für einfache Einbauten anderswo). */
export function FeedbackButton({ className, children = 'Feedback', page, tableId }: FeedbackButtonProps) {
  const feedback = useFeedbackDialog({
    ...(page === undefined ? {} : { page }),
    ...(tableId === undefined ? {} : { tableId }),
  });
  return (
    <>
      <button
        type="button"
        className={className ?? styles.button}
        aria-haspopup="dialog"
        aria-expanded={feedback.isOpen}
        onClick={feedback.open}
      >
        {children}
      </button>
      {feedback.dialog}
    </>
  );
}
