// Avatar-Darstellung (WP-032).
import { AVATAR_IDS } from '@poker/engine/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AVATAR_ART } from './art';
import { Avatar, initialOf } from './Avatar';

describe('Avatar', () => {
  it('zeigt das Motiv mit Beschriftung', () => {
    render(<Avatar avatar="owl" name="anna" />);
    const img = screen.getByRole('img', { name: 'anna: Eule' });
    expect(img.dataset['avatar']).toBe('owl');
    expect(img.getAttribute('viewBox')).toBe('0 0 64 64');
  });

  it('ohne oder mit unbekanntem Avatar: Anfangsbuchstabe', () => {
    const { rerender } = render(<Avatar avatar={null} name="ben" />);
    expect(screen.getByRole('img', { name: 'ben (kein Avatar)' })).toHaveTextContent('B');
    rerender(<Avatar avatar="gibtsnicht" name="ölaf" />);
    expect(screen.getByTestId('avatar').dataset['avatar']).toBe('none');
    expect(screen.getByTestId('avatar')).toHaveTextContent('Ö');
    expect(initialOf('  ')).toBe('?');
  });

  it('dekorativ: für Screenreader ausgeblendet', () => {
    render(<Avatar avatar="fox" name="anna" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('avatar')).toHaveAttribute('aria-hidden', 'true');
  });

  it('jede Avatar-ID hat ein Motiv mit eigener Beschriftung, nur mit SVG-Attributen (CSP: kein style)', () => {
    expect(Object.keys(AVATAR_ART).sort()).toEqual([...AVATAR_IDS].sort());
    const labels = AVATAR_IDS.map((id) => AVATAR_ART[id].label);
    expect(new Set(labels).size).toBe(AVATAR_IDS.length);
    for (const id of AVATAR_IDS) {
      const { container, unmount } = render(<Avatar avatar={id} name="x" />);
      const svg = container.querySelector('svg');
      expect(svg?.children.length).toBeGreaterThan(1);
      expect(container.querySelector('[style]')).toBeNull();
      unmount();
    }
  });
});
