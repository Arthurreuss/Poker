import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { GameTable } from '../game/GameTable';
import { useTableGame } from '../game/hooks';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

/** `/table/:id` – Spieltisch mit Verbindung zum Game-Server (WP-018). */
export function TablePage() {
  const { id = '' } = useParams();
  const tableId = /^\d+$/.test(id) ? Number(id) : null;
  if (tableId === null) {
    return (
      <div className="safe-area" style={{ flex: 1, padding: 'var(--space-4)' }}>
        <PlaceholderPage title="Tisch nicht gefunden">
          <p className={styles.muted}>Die Adresse enthält keine gültige Tisch-Nummer.</p>
        </PlaceholderPage>
      </div>
    );
  }
  return <TableGamePage key={tableId} tableId={tableId} />;
}

function TableGamePage({ tableId }: { tableId: number }) {
  const navigate = useNavigate();
  const [snapshot, store] = useTableGame(tableId);
  const toLobby = useCallback(() => {
    void navigate('/');
  }, [navigate]);
  return <GameTable snapshot={snapshot} store={store} onLeave={toLobby} />;
}
