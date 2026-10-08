import { Link, useParams } from 'react-router';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

/** Platzhalter für /table/:id – WP-016/018 ersetzen ihn durch die Tischansicht (apps/web/src/table/). */
export function TablePage() {
  const { id = '' } = useParams();
  return (
    <div className="safe-area" style={{ flex: 1, padding: 'var(--space-4)' }}>
      <PlaceholderPage title={`Tisch ${id}`}>
        <p className={styles.muted}>Die Tischansicht folgt.</p>
        <Link to="/">Zurück zur Lobby</Link>
      </PlaceholderPage>
    </div>
  );
}
