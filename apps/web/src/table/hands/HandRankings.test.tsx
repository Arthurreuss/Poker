// Hand-Übersicht am Tisch (WP-038).
import { HAND_CATEGORIES, HAND_CATEGORY_NAMES, evaluateHand } from '@poker/engine';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HAND_RANKINGS } from './rankings';
import { HandRankings } from './HandRankings';

afterEach(cleanup);

function toggle() {
  return screen.getByRole('button', { name: 'Pokerhände' });
}

function dialog() {
  return screen.queryByRole('dialog', { name: 'Pokerhände' });
}

describe('HAND_RANKINGS', () => {
  it('Royal Flush oben, danach alle Engine-Kategorien von der stärksten abwärts mit Engine-Namen', () => {
    expect(HAND_RANKINGS).toHaveLength(HAND_CATEGORIES.length + 1);
    expect(HAND_RANKINGS[0]).toMatchObject({ id: 'royal-flush', name: 'Royal Flush', category: 'straight-flush' });
    const rest = HAND_RANKINGS.slice(1);
    expect(rest.map((e) => e.category)).toEqual([...HAND_CATEGORIES].reverse());
    for (const entry of rest) expect(entry.name).toBe(HAND_CATEGORY_NAMES[entry.category]);
  });

  it('jede Beispielhand ist laut Engine die angegebene Kategorie und schlägt die nächste Zeile', () => {
    const results = HAND_RANKINGS.map((entry) => {
      expect(entry.cards).toHaveLength(5);
      expect(new Set(entry.cards).size).toBe(5);
      expect(entry.formingCount).toBeGreaterThanOrEqual(1);
      expect(entry.formingCount).toBeLessThanOrEqual(5);
      const result = evaluateHand(entry.cards);
      expect(result.category, entry.id).toBe(entry.category);
      return result.value;
    });
    for (let i = 1; i < results.length; i += 1) expect(results[i - 1]).toBeGreaterThan(results[i] ?? Infinity);
  });
});

describe('HandRankings', () => {
  it('Knopf öffnet die Übersicht mit allen Händen in Rangfolge und Beispielkarten', () => {
    render(<HandRankings />);
    expect(dialog()).toBeNull();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle());
    const d = dialog();
    expect(d).not.toBeNull();
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getAllByTestId('hand-ranking');
    expect(rows.map((r) => within(r).getByRole('heading').textContent)).toEqual(HAND_RANKINGS.map((e) => e.name));
    const royal = within(rows[0] as HTMLElement).getByRole('group', { name: 'Beispiel Royal Flush' });
    expect(
      within(royal)
        .getAllByRole('img')
        .map((c) => c.dataset['card']),
    ).toEqual(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    // Beikarten treten zurück: beim Paar die drei Kicker
    const pair = rows.find((r) => r.dataset['hand'] === 'pair') as HTMLElement;
    expect(pair.querySelectorAll('.pt-card--dim')).toHaveLength(3);
  });

  it('Fokus springt in den Dialog und beim Schließen zurück auf den Knopf', () => {
    render(<HandRankings />);
    fireEvent.click(toggle());
    expect(screen.getByRole('button', { name: 'Schließen' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(dialog()).toBeNull();
    expect(toggle()).toHaveFocus();
  });

  it('schließt per Escape, Tipp auf den Hintergrund und erneuten Knopfdruck, nicht per Tipp in den Dialog', () => {
    render(<HandRankings />);
    fireEvent.click(toggle());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).toBeNull();

    fireEvent.click(toggle());
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(dialog()).not.toBeNull();
    fireEvent.pointerDown(screen.getByTestId('hands-backdrop'));
    expect(dialog()).toBeNull();

    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(dialog()).toBeNull();
  });

  it('Tab bleibt im Dialog', () => {
    render(<HandRankings />);
    fireEvent.click(toggle());
    const close = screen.getByRole('button', { name: 'Schließen' });
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  it('nutzt das Vier-Farben-Deck wie der Tisch', () => {
    render(<HandRankings fourColor />);
    fireEvent.click(toggle());
    const flush = screen.getAllByTestId('hand-ranking').find((r) => r.dataset['hand'] === 'flush') as HTMLElement;
    expect(flush.querySelector('.pt-ink-blue')).not.toBeNull();
  });
});
