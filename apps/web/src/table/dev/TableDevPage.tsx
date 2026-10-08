import { useEffect, useState } from 'react';
import {
  ORIENTATION_LABELS,
  ORIENTATION_PREFERENCES,
  useOrientationPreference,
  type OrientationPreference,
} from '../../settings/orientation';
import { TableFx } from '../fx/TableFx';
import { ReactionPicker } from '../../reactions/ReactionPicker';
import { TableScreen } from '../TableScreen';
import { FX_DEMO } from './fxDemo';
import { MOCK_STATES, mockById } from './mocks';
import './dev.css';

function parseLayout(value: string | null): OrientationPreference | null {
  return value !== null && (ORIENTATION_PREFERENCES as readonly string[]).includes(value)
    ? (value as OrientationPreference)
    : null;
}

function readParams(): {
  state: string;
  bare: boolean;
  fourColor: boolean;
  layout: OrientationPreference | null;
  fx: boolean;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    state: params.get('state') ?? MOCK_STATES[0]?.id ?? '',
    bare: params.get('bare') === '1',
    fourColor: params.get('four') === '1',
    layout: parseLayout(params.get('layout')),
    fx: params.get('fx') === '1',
  };
}

/**
 * Entwicklungsseite mit Mock-Zuständen der Tischansicht (WP-016). Im Dev-Build unter `/dev/table`
 * (App-Router) und über `table-dev.html` (eigene Entry, für die Playwright-Tests) erreichbar.
 * URL-Parameter: `state=<id>`, `four=1` (Vier-Farben-Deck), `bare=1` (ohne Umschalter, für Screenshots),
 * `layout=auto|portrait|landscape` (WP-017; nur für diese Seite, ohne die gespeicherte Einstellung
 * zu ändern). Ohne `layout` gilt die gespeicherte Einstellung wie am echten Tisch.
 * `fx=1` (WP-031): statt der Mock-Zustände läuft eine Hand mit allen Animationen in Schleife (`fxDemo.ts`).
 */
export function TableDevPage() {
  const initial = readParams();
  const [stateId, setStateId] = useState(initial.state);
  const [fourColor, setFourColor] = useState(initial.fourColor);
  const [stored, setStored] = useOrientationPreference();
  const [override, setOverride] = useState(initial.layout);
  const preference = override ?? stored;
  const setPreference = override === null ? setStored : setOverride;
  const [fxStep, setFxStep] = useState(0);
  const [fxRunning, setFxRunning] = useState(true);
  useEffect(() => {
    if (!initial.fx || !fxRunning) return undefined;
    const id = setInterval(() => {
      setFxStep((n) => (n + 1) % FX_DEMO.length);
    }, 1400);
    return () => {
      clearInterval(id);
    };
  }, [initial.fx, fxRunning]);
  const mock = mockById(stateId) ?? MOCK_STATES[0];
  if (mock === undefined) return null;
  const view = initial.fx ? (FX_DEMO[fxStep] ?? mock.view) : mock.view;
  return (
    <div className="pt-dev">
      {!initial.bare && (
        <div className="pt-dev-bar">
          {initial.fx && (
            <>
              <button
                type="button"
                onClick={() => {
                  setFxRunning((r) => !r);
                }}
              >
                {fxRunning ? 'Pause' : 'Weiter'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFxStep((n) => (n + 1) % FX_DEMO.length);
                }}
              >
                Schritt {fxStep + 1}/{FX_DEMO.length}
              </button>
            </>
          )}
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
          <select
            aria-label="Ausrichtung"
            value={preference}
            onChange={(e) => {
              setPreference(e.target.value as OrientationPreference);
            }}
          >
            {ORIENTATION_PREFERENCES.map((value) => (
              <option key={value} value={value}>
                {ORIENTATION_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="pt-dev-table">
        <TableScreen
          view={view}
          fourColor={fourColor}
          overlay={initial.fx ? <TableFx view={view} enabled /> : undefined}
          preference={preference}
          onPreferenceChange={setPreference}
          actionBar={<div className="pt-dev-action">Platz für die Aktionsleiste (WP-018)</div>}
          reactionPicker={mock.view.heroSeat === null ? undefined : <ReactionPicker onReact={() => true} />}
        />
      </div>
    </div>
  );
}
