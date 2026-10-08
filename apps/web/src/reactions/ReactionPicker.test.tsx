// Reaktions-Knopf am Tisch (WP-032).
import { REACTION_IDS } from '@poker/engine/protocol';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactionPicker } from './ReactionPicker';
import { REACTIONS } from './reactions';

afterEach(() => {
  vi.useRealTimers();
});

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Reaktion senden' }));
}

describe('ReactionPicker', () => {
  it('zeigt alle Reaktionen; ein Klick sendet und schließt', () => {
    const onReact = vi.fn(() => true);
    render(<ReactionPicker onReact={onReact} />);
    open();
    const group = screen.getByRole('group', { name: 'Reaktionen' });
    expect(group.querySelectorAll('button')).toHaveLength(REACTION_IDS.length);
    expect(group).toHaveTextContent(REACTION_IDS.map((id) => REACTIONS[id].emoji).join(''));
    fireEvent.click(screen.getByRole('button', { name: 'Lachen' }));
    expect(onReact).toHaveBeenCalledWith('laugh');
    expect(screen.queryByRole('group', { name: 'Reaktionen' })).toBeNull();
  });

  it('nach dem Senden für die Sperrzeit gesperrt, danach wieder bedienbar', () => {
    vi.useFakeTimers();
    render(<ReactionPicker onReact={() => true} cooldownMs={2000} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Applaus' }));
    const toggle = screen.getByRole('button', { name: 'Reaktion senden' });
    expect(toggle).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(toggle).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toggle).toBeEnabled();
  });

  it('nicht gesendet (keine Verbindung): keine Sperre', () => {
    render(<ReactionPicker onReact={() => false} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Heiß' }));
    expect(screen.getByRole('button', { name: 'Reaktion senden' })).toBeEnabled();
  });

  it('Escape und Klick außerhalb schließen die Leiste', () => {
    render(<ReactionPicker onReact={() => true} />);
    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Reaktionen' })).toBeNull();
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: 'Reaktionen' })).toBeNull();
  });
});
