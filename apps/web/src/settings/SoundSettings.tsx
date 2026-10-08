// Einstellungen → „Ton am Tisch“ (WP-031): Ton an/aus, Lautstärke, Probehören, Vibration (wo verfügbar).
import { useId } from 'react';
import styles from '../pages/Page.module.css';
import { soundEngine } from '../sound/engine';
import own from './SoundSettings.module.css';
import { canVibrate, useSoundPreference } from './sound';

export function SoundSettings() {
  const [pref, update] = useSoundPreference();
  const volumeId = useId();
  const percent = Math.round(pref.volume * 100);
  return (
    <fieldset className={styles.panel}>
      <legend>Ton am Tisch</legend>
      <label className={styles.option}>
        <input
          type="checkbox"
          checked={pref.enabled}
          onChange={(e) => {
            update({ enabled: e.target.checked });
          }}
        />
        Ton (Karten, Chips, „Du bist dran“)
      </label>
      <label htmlFor={volumeId}>Lautstärke</label>
      <div className={own.volume}>
        <input
          id={volumeId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={!pref.enabled}
          aria-valuetext={`${String(percent)} %`}
          className={own.range}
          onChange={(e) => {
            update({ volume: Number(e.target.value) / 100 });
          }}
        />
        <span className={own.value}>{percent} %</span>
        <button
          type="button"
          disabled={!pref.enabled}
          className={own.preview}
          onClick={() => {
            soundEngine.setVolume(pref.volume);
            soundEngine.preview('turn');
          }}
        >
          Probehören
        </button>
      </div>
      {canVibrate() && (
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={pref.vibrate}
            onChange={(e) => {
              update({ vibrate: e.target.checked });
            }}
          />
          Vibrieren, wenn du dran bist
        </label>
      )}
      <p className={styles.muted}>Wird nur auf diesem Gerät gespeichert.</p>
    </fieldset>
  );
}
