import { useState } from 'react';
import { PokerTable } from '../PokerTable';
import { MOCK_STATES, mockById } from './mocks';
import './dev.css';

function readParams(): { state: string; bare: boolean; fourColor: boolean } {
  const params = new URLSearchParams(window.location.search);
  return {
    state: params.get('state') ?? MOCK_STATES[0]?.id ?? '',
    bare: params.get('bare') === '1',
    fourColor: params.get('four') === '1',
  };
}

/**
 * Entwicklungsseite mit Mock-Zuständen der Tischansicht (WP-016). Im Dev-Build unter `/dev/table`
 * (App-Router) und über `table-dev.html` (eigene Entry, für die Playwright-Tests) erreichbar.
 * URL-Parameter: `state=<id>`, `four=1` (Vier-Farben-Deck), `bare=1` (ohne Umschalter, für Screenshots).
 */
export function TableDevPage() {
  const initial = readParams();
  const [stateId, setStateId] = useState(initial.state);
  const [fourColor, setFourColor] = useState(initial.fourColor);
  const mock = mockById(stateId) ?? MOCK_STATES[0];
  if (mock === undefined) return null;
  return (
    <div className="pt-dev">
      {!initial.bare && (
        <div className="pt-dev-bar">
          <select
            aria-label="Mock-Zustand"
            value={mock.id}
            onChange={(e) => {
              setStateId(e.target.value);
            }}
          >
            {MOCK_STATES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={fourColor}
              onChange={(e) => {
                setFourColor(e.target.checked);
              }}
            />{' '}
            4 Farben
          </label>
        </div>
      )}
      <div className="pt-dev-table">
        <PokerTable
          view={mock.view}
          fourColor={fourColor}
          actionBar={<div className="pt-dev-action">Platz für die Aktionsleiste (WP-018)</div>}
        />
      </div>
    </div>
  );
}
