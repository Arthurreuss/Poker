import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

/** Platzhalter für /admin/* (nur Admins). WP-024 ergänzt /admin/feedback. */
export function AdminPage() {
  return (
    <PlaceholderPage title="Admin">
      <p className={styles.muted}>Admin-Bereich – Funktionen folgen.</p>
    </PlaceholderPage>
  );
}
