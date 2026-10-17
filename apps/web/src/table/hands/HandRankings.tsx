/**
 * Hand-Übersicht am Tisch (WP-038): Knopf unter dem Reaktions-Knopf oben rechts, öffnet einen
 * modalen Dialog mit allen Pokerhänden in Rangfolge (Inhalt: `rankings.ts`). Der Dialog wird per
 * Portal in `document.body` gerendert, damit er den ganzen Bildschirm nutzt und nicht in der
 * Tischfläche (Container-Query) eingesperrt ist. Schließt per Knopf, Tipp auf den Hintergrund und
 * Escape; der Fokus bleibt im Dialog und springt danach zurück auf den Knopf.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../Card';
import { HAND_RANKINGS } from './rankings';
import './hands.css';

export interface HandRankingsProps {
  /** Vier-Farben-Deck wie am Tisch. */
  readonly fourColor?: boolean;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

/** Zwei aufgefächerte Karten als Symbol des Knopfs (selbst gezeichnet, D-008). */
function HandsSvg() {
  return (
    <svg viewBox="0 0 24 24" className="pt-hands-icon" aria-hidden="true" focusable="false">
      <rect
        x="3.5"
        y="5"
        width="10"
        height="14"
        rx="1.6"
        transform="rotate(-12 8.5 12)"
        className="pt-hands-icon-back"
      />
      <rect x="10" y="4" width="10" height="14" rx="1.6" transform="rotate(10 15 11)" className="pt-hands-icon-front" />
      <path d="M15.6 8.4 17.4 11 15.6 13.6 13.8 11Z" transform="rotate(10 15 11)" className="pt-hands-icon-pip" />
    </svg>
  );
}

export function HandRankings({ fourColor = false }: HandRankingsProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const dialogId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const toggle = toggleRef.current;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      toggle?.focus();
    };
  }, [open]);

  /** Tab und Umschalt+Tab wandern nur zwischen den Elementen im Dialog. */
  const trapFocus = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || panelRef.current === null) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="pt-hands-toggle"
        aria-label="Pokerhände"
        title="Pokerhände"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <HandsSvg />
      </button>
      {open &&
        createPortal(
          <div
            className="pt-hands-backdrop"
            data-testid="hands-backdrop"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <div
              ref={panelRef}
              id={dialogId}
              className="pt-hands-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onKeyDown={trapFocus}
            >
              <div className="pt-hands-head">
                <h2 id={titleId} className="pt-hands-title">
                  Pokerhände
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  className="pt-hands-close"
                  aria-label="Schließen"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <p className="pt-hands-intro">Von der besten zur schwächsten Hand. Es zählen die besten fünf Karten.</p>
              <ol className="pt-hands-list" aria-label="Pokerhände, beste zuerst">
                {HAND_RANKINGS.map((entry, index) => (
                  <li key={entry.id} className="pt-hands-item" data-testid="hand-ranking" data-hand={entry.id}>
                    <div className="pt-hands-row">
                      <span className="pt-hands-rank" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="pt-hands-text">
                        <h3 className="pt-hands-name">{entry.name}</h3>
                        <p className="pt-hands-desc">{entry.description}</p>
                      </div>
                      <div className="pt-hands-cards" role="group" aria-label={`Beispiel ${entry.name}`}>
                        {entry.cards.map((card, i) => (
                          <Card
                            key={card}
                            card={card}
                            size="seat"
                            fourColor={fourColor}
                            highlight={i < entry.formingCount ? undefined : 'dim'}
                          />
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="pt-hands-note">
                Gleiche Hand: Es entscheiden die höheren Karten, danach die Beikarten (Kicker). Die Farben haben keinen
                Rang.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
