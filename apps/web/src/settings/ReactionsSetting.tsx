// Einstellungen → Emoji-Reaktionen am Tisch ein/aus (WP-032). Nur auf diesem Gerät gespeichert.
import pageStyles from '../pages/Page.module.css';
import { useReactionsPreference } from './reactions';

export function ReactionsSetting() {
  const [enabled, setEnabled] = useReactionsPreference();
  return (
    <fieldset className={pageStyles.panel}>
      <legend>Reaktionen am Tisch</legend>
      <label className={pageStyles.option}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
        />
        Emoji-Reaktionen anzeigen und senden
      </label>
      <p className={pageStyles.muted}>
        Wird nur auf diesem Gerät gespeichert. Aus: Du siehst keine Reaktionen der anderen und hast keinen
        Reaktions-Knopf.
      </p>
    </fieldset>
  );
}
