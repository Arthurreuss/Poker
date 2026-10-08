import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ORIENTATION_LABELS, ORIENTATION_PREFERENCES, type OrientationPreference } from '../settings/orientation';
import { MenuSvg } from './assets/icons';

export interface TableMenuProps {
  /** Aktuelle Ausrichtungs-Präferenz (D-009). */
  readonly preference: OrientationPreference;
  readonly onPreferenceChange: (value: OrientationPreference) => void;
  /** Weitere Einträge (z. B. „Tisch verlassen“, WP-018) unter dem Ausrichtungs-Umschalter. */
  readonly children?: ReactNode;
}

/**
 * Tisch-Menü (WP-017): Knopf oben links am Tisch, öffnet ein kleines Panel mit dem Umschalter
 * Auto/Hoch/Quer. Schließt bei Escape und Klick außerhalb. Die Auswahl wirkt sofort; der Tisch
 * wird dabei nicht neu aufgebaut (siehe PokerTable).
 */
export function TableMenu({ preference, onPreferenceChange, children }: TableMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const groupName = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="pt-menu" ref={rootRef} data-testid="table-menu">
      <button
        type="button"
        className="pt-menu-button"
        aria-label="Tisch-Menü"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <MenuSvg />
      </button>
      {open && (
        <div className="pt-menu-panel" id={panelId} role="group" aria-label="Tisch-Menü">
          <fieldset className="pt-menu-group">
            <legend className="pt-menu-legend">Ausrichtung</legend>
            {ORIENTATION_PREFERENCES.map((value) => (
              <label key={value} className="pt-menu-option">
                <input
                  type="radio"
                  name={groupName}
                  value={value}
                  checked={preference === value}
                  onChange={() => {
                    onPreferenceChange(value);
                  }}
                />
                <span>{ORIENTATION_LABELS[value]}</span>
              </label>
            ))}
          </fieldset>
          {children}
        </div>
      )}
    </div>
  );
}
