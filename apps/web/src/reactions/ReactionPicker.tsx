/**
 * Reaktions-Knopf am Tisch (WP-032): öffnet eine Leiste mit den festen Emojis; ein Klick sendet die
 * Reaktion und schließt die Leiste. Danach ist der Knopf für die Sperrzeit des Servers (eine Reaktion
 * je 2 s) gesperrt, damit niemand in den Fehler `RATE_LIMITED` läuft. Nur für Spieler mit Platz.
 */
import { REACTION_COOLDOWN_MS, type ReactionId } from '@poker/engine/protocol';
import { useEffect, useId, useRef, useState } from 'react';
import { REACTION_ORDER, REACTIONS } from './reactions';
import styles from './ReactionPicker.module.css';

export interface ReactionPickerProps {
  /** Sendet die Reaktion; `false` = nicht gesendet (z. B. keine Verbindung), dann keine Sperre. */
  readonly onReact: (reaction: ReactionId) => boolean;
  /** Sperrzeit nach dem Senden (Standard: die des Servers). */
  readonly cooldownMs?: number;
}

export function ReactionPicker({ onReact, cooldownMs = REACTION_COOLDOWN_MS }: ReactionPickerProps) {
  const [open, setOpen] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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

  useEffect(() => {
    if (!coolingDown) return undefined;
    const timer = window.setTimeout(() => {
      setCoolingDown(false);
    }, cooldownMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [coolingDown, cooldownMs]);

  return (
    <div className={styles.root} ref={rootRef} data-testid="reaction-picker">
      <button
        type="button"
        className={styles.toggle}
        aria-label="Reaktion senden"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={coolingDown}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">🙂</span>
      </button>
      {open && (
        <div className={styles.panel} id={panelId} role="group" aria-label="Reaktionen">
          {REACTION_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={styles.option}
              aria-label={REACTIONS[id].label}
              title={REACTIONS[id].label}
              onClick={() => {
                setOpen(false);
                if (onReact(id)) setCoolingDown(true);
              }}
            >
              <span aria-hidden="true">{REACTIONS[id].emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
