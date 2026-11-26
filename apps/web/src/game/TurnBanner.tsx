// „Du bist dran“ auf allen Seiten der App-Shell (ADR XXXX): Hinweis mit Sprung an den Tisch, dazu Ton und
// Vibration nach den Einstellungen („Ton am Tisch“) und ein blinkender Tab-Titel. Am Tisch selbst zeigt
// das die Aktionsleiste; die Tischseite liegt außerhalb der App-Shell.
import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useSoundPreference, type SoundPreference } from '../settings/sound';
import { soundEngine, type SoundEngine } from '../sound/engine';
import { TURN_VIBRATION } from '../sound/tableSounds';
import { useAppConnection } from './ConnectionProvider';
import styles from './TurnBanner.module.css';
import type { TurnAlert } from './turnWatcher';

/** Wechsel des Tab-Titels, solange man dran ist. */
export const TITLE_BLINK_MS = 1000;

const noSubscribe = () => () => undefined;
const noAlert = () => null;

/** Ton und Vibration für einen neuen Zug, wie in den Einstellungen gewählt. */
export function signalTurn(
  pref: SoundPreference,
  engine: Pick<SoundEngine, 'setVolume' | 'play'> = soundEngine,
  vibrate: ((pattern: number[]) => unknown) | null = typeof navigator.vibrate === 'function'
    ? (pattern) => navigator.vibrate(pattern)
    : null,
): void {
  if (pref.enabled) {
    engine.setVolume(pref.volume);
    engine.play('turn');
  }
  if (pref.vibrate && vibrate !== null) {
    try {
      vibrate(TURN_VIBRATION);
    } catch {
      // nicht unterstützt
    }
  }
}

function useTurnAlert(): TurnAlert | null {
  const turns = useAppConnection()?.turns;
  return useSyncExternalStore(turns?.subscribe ?? noSubscribe, turns?.getSnapshot ?? noAlert, noAlert);
}

export function TurnBanner() {
  const alert = useTurnAlert();
  const [pref] = useSoundPreference();
  const key = alert?.key ?? null;
  const name = alert?.tableName ?? null;

  useEffect(() => {
    soundEngine.install();
  }, []);

  // Je Zug einmal; ein geänderter Schalter in den Einstellungen löst kein erneutes Signal aus.
  useEffect(() => {
    if (key !== null) signalTurn(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (name === null) return undefined;
    const base = document.title;
    const marked = `Du bist dran – ${name}`;
    const id = setInterval(() => {
      document.title = document.title === marked ? base : marked;
    }, TITLE_BLINK_MS);
    return () => {
      clearInterval(id);
      document.title = base;
    };
  }, [name]);

  if (alert === null) return null;
  return (
    <div role="alert" className={styles.banner}>
      <span>Du bist dran an „{alert.tableName}“</span>
      <Link to={`/table/${String(alert.tableId)}`} className={styles.link}>
        Zum Tisch
      </Link>
    </div>
  );
}
