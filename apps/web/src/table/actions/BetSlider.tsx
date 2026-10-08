import { useId, useState } from 'react';
import { formatChips } from '../format';
import { clampWager, type Preset, type WagerRange } from './logic';

export interface BetSliderProps {
  /** Erlaubter Bereich aus `legalActions` (Gesamteinsatz der Straße). */
  readonly range: WagerRange;
  readonly value: number;
  readonly onChange: (value: number) => void;
  /** Schnellwahl (½ Pot, Pot, All-in). */
  readonly presets: readonly Preset[];
  /** Schrittweite des Reglers (z. B. Small Blind); Min und Max sind immer erreichbar. */
  readonly step?: number;
  readonly disabled?: boolean;
}

/**
 * Einsatzwahl: Schnellwahl, Regler und Zahleneingabe. Grenzen kommen nur aus `range` (Server).
 * Die Eingabe darf beim Tippen kurz außerhalb liegen (wird markiert) und wird beim Verlassen
 * auf den Bereich geklemmt; `value` liegt immer im Bereich.
 */
export function BetSlider({ range, value, onChange, presets, step = 1, disabled = false }: BetSliderProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : Number(draft.replace(/\D/g, ''));
  const invalid = draft !== null && (draft.trim() === '' || parsed < range.min || parsed > range.max);

  const commitDraft = () => {
    if (draft === null) return;
    onChange(clampWager(draft.trim() === '' ? value : parsed, range));
    setDraft(null);
  };

  // Regler in Schritten ab `min`; der letzte Schritt landet immer genau auf `max`.
  const steps = Math.max(1, Math.ceil((range.max - range.min) / Math.max(1, step)));
  const position =
    range.max === range.min ? steps : Math.round(((value - range.min) / (range.max - range.min)) * steps);
  const fromPosition = (pos: number) =>
    pos >= steps ? range.max : clampWager(range.min + pos * Math.max(1, step), range);

  return (
    <div className="ab-sizer" data-testid="bet-slider">
      <div className="ab-presets" role="group" aria-label="Schnellwahl">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="ab-preset"
            aria-pressed={p.value === value}
            disabled={disabled}
            onClick={() => {
              setDraft(null);
              onChange(p.value);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="ab-slider-row">
        <input
          type="range"
          className="ab-range"
          aria-label="Einsatz"
          aria-valuetext={formatChips(value)}
          min={0}
          max={steps}
          step={1}
          value={position}
          disabled={disabled}
          onChange={(e) => {
            setDraft(null);
            onChange(fromPosition(Number(e.target.value)));
          }}
        />
        <label className="visually-hidden" htmlFor={inputId}>
          Betrag
        </label>
        <input
          id={inputId}
          className="ab-amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid}
          data-min={range.min}
          data-max={range.max}
          value={draft ?? String(value)}
          disabled={disabled}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const n = Number(text.replace(/\D/g, ''));
            if (text.trim() !== '' && n >= range.min && n <= range.max) onChange(n);
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDraft();
          }}
        />
      </div>
      <p className="ab-limits" aria-live="polite">
        {invalid
          ? `Erlaubt: ${formatChips(range.min)} – ${formatChips(range.max)}`
          : `Min ${formatChips(range.min)} · Max ${formatChips(range.max)}`}
      </p>
    </div>
  );
}
