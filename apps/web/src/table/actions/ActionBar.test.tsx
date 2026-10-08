import type { Action, LegalAction, LegalActions } from '@poker/engine';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar, type ActionBarProps } from './ActionBar';
import { BetSlider } from './BetSlider';
import type { PreActionKind, WagerRange } from './logic';

const legal = (actions: LegalAction[], toCall = 0): LegalActions => ({ playerId: '1', toCall, actions });

const FACING_RAISE = legal(
  [
    { type: 'fold' },
    { type: 'call', amount: 40 },
    { type: 'raise', min: 80, max: 980 },
    { type: 'allIn', amount: 960, to: 980 },
  ],
  40,
);
const POT = { pot: 70, toCall: 40, currentBet: 60 };

function renderBar(props: Partial<ActionBarProps> = {}) {
  const onAction = vi.fn<(a: Action) => void>();
  const utils = render(<ActionBar legal={FACING_RAISE} pot={POT} onAction={onAction} {...props} />);
  return { onAction, ...utils };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('ActionBar – am Zug', () => {
  it('Fold, Call mit Betrag und Raise; Aktionen gehen an onAction', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar();
    expect(button(/^Call\s*40$/)).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Check/ })).toBeNull();
    await user.click(button('Fold'));
    await user.click(button(/^Call/));
    expect(onAction.mock.calls).toEqual([[{ type: 'fold' }], [{ type: 'call' }]]);
  });

  it('Check statt Call, Bet statt Raise, wenn nichts offen ist', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar({
      legal: legal([
        { type: 'fold' },
        { type: 'check' },
        { type: 'bet', min: 20, max: 1500 },
        { type: 'allIn', amount: 1500, to: 1500 },
      ]),
      pot: { pot: 60, toCall: 0, currentBet: 0 },
    });
    await user.click(button('Check'));
    expect(onAction).toHaveBeenCalledWith({ type: 'check' });
    expect(button(/^Bet/)).toBeEnabled();
  });

  it('Raise öffnet die Einsatzwahl beim Minimum (Mindest-Raise) und bestätigt den Betrag', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar();
    await user.click(button(/^Raise/));
    expect(screen.getByRole('dialog', { name: 'Raise-Betrag wählen' })).toBeInTheDocument();
    expect(screen.getByLabelText('Betrag')).toHaveValue('80');
    await user.click(button(/^Raise auf\s*80$/));
    expect(onAction).toHaveBeenCalledWith({ type: 'raise', amount: 80 });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Schnellwahl Pot und All-in; der Höchstbetrag wird als All-in gesendet', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar();
    await user.click(button(/^Raise/));
    await user.click(button('Pot'));
    // höchster Einsatz 60 + (Pot 70 + Call 40) = 170
    expect(screen.getByLabelText('Betrag')).toHaveValue('170');
    expect(button('Pot')).toHaveAttribute('aria-pressed', 'true');
    await user.click(button('All-in'));
    await user.click(button(/^All-in\s*980$/));
    expect(onAction).toHaveBeenCalledWith({ type: 'allIn' });
  });

  it('Escape schließt die Einsatzwahl ohne Aktion', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar();
    await user.click(button(/^Raise/));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('Call ins All-in: kein Raise möglich', () => {
    renderBar({
      legal: legal([{ type: 'fold' }, { type: 'call', amount: 300 }, { type: 'allIn', amount: 300, to: 340 }], 300),
    });
    expect(button(/^All-in\s*300$/)).toBeEnabled();
    expect(button('Raise')).toBeDisabled();
  });

  it('All-in unter dem Mindest-Raise als eigener Knopf', async () => {
    const user = userEvent.setup();
    const { onAction } = renderBar({
      legal: legal([{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'allIn', amount: 150, to: 200 }], 100),
    });
    await user.click(button(/^All-in\s*200$/));
    expect(onAction).toHaveBeenCalledWith({ type: 'allIn' });
  });

  it('nur legale Aktionen bedienbar; disabled sperrt alles', () => {
    const { rerender, onAction } = renderBar({ legal: legal([{ type: 'fold' }]) });
    expect(button('Fold')).toBeEnabled();
    expect(button(/^Call/)).toBeDisabled();
    expect(button('Raise')).toBeDisabled();
    rerender(<ActionBar legal={FACING_RAISE} pot={POT} onAction={onAction} disabled />);
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('neue Grenzen vom Server setzen die Einsatzwahl zurück', async () => {
    const user = userEvent.setup();
    const { rerender, onAction } = renderBar();
    await user.click(button(/^Raise/));
    rerender(
      <ActionBar
        legal={legal([{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'raise', min: 200, max: 980 }], 100)}
        pot={POT}
        onAction={onAction}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(button(/^Raise/));
    expect(screen.getByLabelText('Betrag')).toHaveValue('200');
  });
});

describe('ActionBar – Vorab-Aktionen', () => {
  function PreHarness({ toCall, onSelect }: { toCall: number; onSelect?: (c: unknown) => void }) {
    const [selected, setSelected] = useState<{ kind: PreActionKind; amount: number } | null>(null);
    return (
      <ActionBar
        legal={null}
        pot={POT}
        onAction={() => undefined}
        preAction={{
          toCall,
          selected,
          onSelect: (c) => {
            onSelect?.(c);
            setSelected(c);
          },
        }}
      />
    );
  }

  it('zeigt Fold / Call Betrag / Call any und schaltet die Wahl um', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<PreHarness toCall={40} onSelect={onSelect} />);
    expect(screen.getByRole('group', { name: 'Vorab-Aktion' })).toBeInTheDocument();
    const call = button(/^Call\s*40$/);
    await user.click(call);
    expect(call).toHaveAttribute('aria-pressed', 'true');
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'call', amount: 40 });
    await user.click(call);
    expect(call).toHaveAttribute('aria-pressed', 'false');
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('ohne offenen Betrag: Check/Fold und Check', () => {
    render(<PreHarness toCall={0} />);
    expect(button('Check/Fold')).toBeInTheDocument();
    expect(button('Check')).toBeInTheDocument();
    expect(button('Call any')).toBeInTheDocument();
  });

  it('nicht am Zug und keine Vorab-Aktionen: nichts', () => {
    const { container } = render(<ActionBar legal={null} pot={POT} onAction={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BetSlider', () => {
  const RANGE: WagerRange = { type: 'raise', min: 80, max: 985, allInTo: 985 };

  function Harness({ step = 20 }: { step?: number }) {
    const [value, setValue] = useState(RANGE.min);
    return (
      <>
        <BetSlider range={RANGE} value={value} onChange={setValue} presets={[]} step={step} />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  const value = () => Number(screen.getByTestId('value').textContent);

  it('Regler: Minimum links, Maximum immer erreichbar, Schritte dazwischen', () => {
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Einsatz' });
    const max = Number(slider.getAttribute('max'));
    fireEvent.change(slider, { target: { value: String(max) } });
    expect(value()).toBe(985);
    fireEvent.change(slider, { target: { value: '1' } });
    expect(value()).toBe(100);
    fireEvent.change(slider, { target: { value: '0' } });
    expect(value()).toBe(80);
  });

  it('Eingabe außerhalb der Grenzen wird markiert und beim Verlassen geklemmt', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Betrag');
    await user.clear(input);
    await user.type(input, '5000');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Erlaubt:/)).toBeInTheDocument();
    expect(value()).toBe(500); // letzter gültiger Zwischenstand beim Tippen
    await user.tab();
    expect(value()).toBe(985);
    expect(input).toHaveValue('985');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('gültige Eingabe übernimmt den Betrag sofort; zu wenig wird aufs Minimum gehoben', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Betrag');
    await user.clear(input);
    await user.type(input, '250');
    expect(value()).toBe(250);
    await user.clear(input);
    await user.type(input, '7{Enter}');
    expect(value()).toBe(80);
  });
});
