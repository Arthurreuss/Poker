import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

/** Platzhalter bis WP-019. */
export function LeaderboardPage() {
  return (
    <PlaceholderPage title="Rangliste">
      <p className={styles.muted}>Die Rangliste folgt.</p>
    </PlaceholderPage>
  );
}
