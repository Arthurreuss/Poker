// Tisch-Ereignisse → Sounds und Vibration (WP-031). `soundsFor` ist rein und unit-getestet;
// `useTableSounds` spielt sie über die `SoundEngine` ab.
import { useEffect, useRef } from 'react';
import { useSoundPreference } from '../settings/sound';
import { diffTableViews, type TableEvent } from '../table/fx/events';
import type { TableView } from '../table/types';
import { soundEngine, type SoundEngine } from './engine';
import type { SoundName } from './synth';

export interface ScheduledSound {
  readonly name: SoundName;
  readonly delayMs: number;
}

/** Vibrationsmuster für „Du bist dran“ (ms an/aus). */
export const TURN_VIBRATION = [60, 40, 60];

/** Klänge zu den Ereignissen eines Übergangs, zeitlich passend zu den Animationen. */
export function soundsFor(events: readonly TableEvent[]): ScheduledSound[] {
  const out: ScheduledSound[] = [];
  let afterCollect = 0;
  for (const e of events) {
    switch (e.type) {
      case 'deal': {
        const cards = Math.min(e.seats.length * 2, 8);
        for (let i = 0; i < cards; i++) out.push({ name: 'card', delayMs: i * 70 });
        break;
      }
      case 'board':
        for (let i = e.from; i < e.to; i++) out.push({ name: 'flip', delayMs: (i - e.from) * 120 });
        break;
      case 'bet':
        out.push({ name: 'chips', delayMs: 0 });
        break;
      case 'check':
        out.push({ name: 'check', delayMs: 0 });
        break;
      case 'fold':
        out.push({ name: 'fold', delayMs: 0 });
        break;
      case 'collect':
        out.push({ name: 'collect', delayMs: 120 });
        afterCollect = 380;
        break;
      case 'reveal':
        out.push({ name: 'flip', delayMs: 0 });
        break;
      case 'win':
        out.push({ name: e.hero ? 'win' : 'collect', delayMs: afterCollect + 200 });
        break;
      case 'yourTurn':
        out.push({ name: 'turn', delayMs: 0 });
        break;
    }
  }
  // Gleiche Klänge im selben Moment nur einmal (z. B. mehrere Reveals).
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.name}@${String(s.delayMs)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Spielt passend zur (dargestellten) Tischansicht Sounds ab und vibriert bei „Du bist dran“. */
export function useTableSounds(view: TableView | null, engine: SoundEngine = soundEngine): void {
  const [pref] = useSoundPreference();
  const prev = useRef<TableView | null>(null);

  useEffect(() => {
    engine.install();
  }, [engine]);

  useEffect(() => {
    engine.setVolume(pref.enabled ? pref.volume : 0);
  }, [engine, pref.enabled, pref.volume]);

  useEffect(() => {
    if (view === null) {
      prev.current = null;
      return;
    }
    const events = diffTableViews(prev.current, view);
    prev.current = view;
    if (events.length === 0) return;
    if (pref.enabled) for (const s of soundsFor(events)) engine.play(s.name, s.delayMs);
    if (pref.vibrate && events.some((e) => e.type === 'yourTurn')) {
      try {
        if (typeof navigator.vibrate === 'function') navigator.vibrate(TURN_VIBRATION);
      } catch {
        // nicht unterstützt
      }
    }
  }, [view, engine, pref.enabled, pref.vibrate]);
}
