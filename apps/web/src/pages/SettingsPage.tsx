import { DeleteAccount } from '../settings/DeleteAccount';
import { ORIENTATION_LABELS, ORIENTATION_PREFERENCES, useOrientationPreference } from '../settings/orientation';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

export function SettingsPage() {
  const [orientation, setOrientation] = useOrientationPreference();
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
      <DeleteAccount />
    </PlaceholderPage>
  );
}
