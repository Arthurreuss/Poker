import { useAnimationsPreference } from '../settings/animations';
import { DeleteAccount } from '../settings/DeleteAccount';
import { ORIENTATION_LABELS, ORIENTATION_PREFERENCES, useOrientationPreference } from '../settings/orientation';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

export function SettingsPage() {
  const [orientation, setOrientation] = useOrientationPreference();
  const [animations, setAnimations] = useAnimationsPreference();
  return (
    <PlaceholderPage title="Einstellungen">
      <fieldset className={styles.panel}>
        <legend>Ausrichtung am Tisch</legend>
        {ORIENTATION_PREFERENCES.map((value) => (
          <label key={value} className={styles.option}>
            <input
              type="radio"
              name="orientation"
              value={value}
              checked={orientation === value}
              onChange={() => {
                setOrientation(value);
              }}
            />
            {ORIENTATION_LABELS[value]}
          </label>
        ))}
        <p className={styles.muted}>Wird nur auf diesem Gerät gespeichert.</p>
      </fieldset>
      <fieldset className={styles.panel}>
        <legend>Darstellung am Tisch</legend>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={animations}
            onChange={(e) => {
              setAnimations(e.target.checked);
            }}
          />
          Animationen (Karten, Chips)
        </label>
        <p className={styles.muted}>
          Wird nur auf diesem Gerät gespeichert. Ist „Bewegung reduzieren“ im System aktiv, bleiben Animationen immer
          aus.
        </p>
      </fieldset>
      <DeleteAccount />
    </PlaceholderPage>
  );
}
