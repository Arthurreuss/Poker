import { useEffect, useState } from 'react';
import type { Action, LegalActions } from '@poker/engine';
import { formatChips } from '../format';
import { BetSlider } from './BetSlider';
import {
  actionOptions,
  clampWager,
  preActionChoices,
  wagerAction,
  wagerPresets,
  type PotContext,
  type PreActionKind,
} from './logic';
import './actions.css';

export interface PreActionProps {
  /** Offener Betrag aus Sicht des eigenen Spielers. */
  readonly toCall: number;
  readonly selected: { readonly kind: PreActionKind; readonly amount: number } | null;
  readonly onSelect: (choice: { kind: PreActionKind; amount: number } | null) => void;
}

export interface ActionBarProps {
  /** Erlaubte Aktionen, wenn man am Zug ist (Server, D-003); `null` = nicht am Zug. */
  readonly legal: LegalActions | null;
  /** Pot-Kontext für die Schnellwahl. */
  readonly pot: PotContext;
  /** Schrittweite des Reglers (Small Blind bzw. 1). */
  readonly step?: number;
  readonly onAction: (action: Action) => void;
  /** Vorab-Aktionen, wenn man nicht am Zug ist, aber noch handeln kann. */
  readonly preAction?: PreActionProps | null;
  /** z. B. Aktion unterwegs oder keine Verbindung. */
  readonly disabled?: boolean;
}

function Amount({ value }: { value: number }) {
  return <span className="ab-btn-amount">{formatChips(value)}</span>;
}

/**
 * Aktionsleiste (WP-018): Fold, Check/Call, Bet/Raise (mit Einsatzwahl) – nur, was `legalActions`
 * erlaubt. Ist man nicht am Zug, zeigt sie Vorab-Aktionen. Passt in den `actionBar`-Bereich beider
 * Layouts: eine Zeile großer Knöpfe; die Einsatzwahl öffnet sich darüber.
 */
export function ActionBar({ legal, pot, step = 1, onAction, preAction = null, disabled = false }: ActionBarProps) {
  if (legal !== null) {
    // Neuer Stand vom Server (andere Grenzen) → frischer Zustand: Betrag aufs Minimum, Einsatzwahl zu.
    return (
      <TurnActions key={rangeKey(legal)} legal={legal} pot={pot} step={step} onAction={onAction} disabled={disabled} />
    );
  }
  if (preAction !== null) return <PreActions {...preAction} disabled={disabled} />;
  return null;
}

function rangeKey(legal: LegalActions): string {
  return JSON.stringify(legal.actions);
}

function TurnActions({
  legal,
  pot,
  step,
  onAction,
  disabled,
}: {
  legal: LegalActions;
  pot: PotContext;
  step: number;
  onAction: (action: Action) => void;
  disabled: boolean;
}) {
  const o = actionOptions(legal);
  const wager = o.wager;
  const [sizing, setSizing] = useState(false);
  const [amount, setAmount] = useState(wager?.min ?? 0);
  const value = wager === null ? 0 : clampWager(amount, wager);
  const wagerLabel = wager?.type === 'bet' ? 'Bet' : 'Raise';

  useEffect(() => {
    if (!sizing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSizing(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [sizing]);

  const send = (action: Action) => {
    setSizing(false);
    onAction(action);
  };

  return (
    <div className="ab-root" data-testid="action-bar" data-mode="turn">
      {sizing && wager !== null && (
        <div className="ab-panel" role="dialog" aria-label={`${wagerLabel}-Betrag wählen`}>
          <BetSlider
            range={wager}
            value={value}
            onChange={setAmount}
            presets={wagerPresets(pot, wager)}
            step={step}
            disabled={disabled}
          />
        </div>
      )}
      <div className="ab-row">
        <button
          type="button"
          className="ab-btn ab-btn--fold"
          disabled={disabled || !o.fold}
          onClick={() => {
            send({ type: 'fold' });
          }}
        >
          Fold
        </button>
        {o.check ? (
          <button
            type="button"
            className="ab-btn ab-btn--call"
            disabled={disabled}
            onClick={() => {
              send({ type: 'check' });
            }}
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            className="ab-btn ab-btn--call"
            disabled={disabled || o.call === null}
            onClick={() => {
              send({ type: 'call' });
            }}
          >
            {o.callIsAllIn ? 'All-in' : 'Call'}
            {o.call !== null && <Amount value={o.call} />}
          </button>
        )}
        {wager !== null ? (
          sizing ? (
            <button
              type="button"
              className="ab-btn ab-btn--raise"
              disabled={disabled}
              onClick={() => {
                send(wagerAction(value, wager));
              }}
            >
              {wager.allInTo === value ? 'All-in' : wager.type === 'bet' ? 'Bet' : 'Raise auf'}
              <Amount value={value} />
            </button>
          ) : (
            <button
              type="button"
              className="ab-btn ab-btn--raise"
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => {
                setAmount(wager.min);
                setSizing(true);
              }}
            >
              {wagerLabel}
              <span className="ab-btn-amount">…</span>
            </button>
          )
        ) : o.shortAllIn !== null ? (
          <button
            type="button"
            className="ab-btn ab-btn--raise"
            disabled={disabled}
            onClick={() => {
              send({ type: 'allIn' });
            }}
          >
            All-in
            <Amount value={o.shortAllIn.to} />
          </button>
        ) : (
          <button type="button" className="ab-btn ab-btn--raise" disabled>
            Raise
          </button>
        )}
      </div>
    </div>
  );
}

function PreActions({ toCall, selected, onSelect, disabled }: PreActionProps & { disabled: boolean }) {
  return (
    <div className="ab-root" data-testid="action-bar" data-mode="pre">
      <div className="ab-row" role="group" aria-label="Vorab-Aktion">
        {preActionChoices(toCall).map((c) => {
          const active = selected !== null && selected.kind === c.kind && selected.amount === c.amount;
          return (
            <button
              key={c.kind}
              type="button"
              className={`ab-btn ab-btn--pre ab-btn--pre-${c.kind}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => {
                onSelect(active ? null : { kind: c.kind, amount: c.amount });
              }}
            >
              <span className="ab-check" aria-hidden="true" />
              {c.label}
              {c.kind === 'call' && <Amount value={c.amount} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
