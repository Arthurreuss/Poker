// Nur im Dev-Build (`/dev/new-table`): Tisch direkt per WebSocket anlegen, ohne den Weg über die Lobby
// – für manuelle Tests und den Playwright-Test mit mehreren Browsern.
// Der Ersteller sitzt danach auf Platz 1 (Sitz 0).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import type { ServerMessage } from '@poker/engine/protocol';
import { useConnection } from '../ConnectionProvider';

export function DevNewTablePage() {
  const navigate = useNavigate();
  const connection = useConnection();
  // Als externer Zustand gelesen: Die Verbindung kann schon offen sein, bevor die Seite ihre Meldungen abonniert.
  const subscribe = useCallback((onChange: () => void) => connection.onStatus(onChange), [connection]);
  const status = useSyncExternalStore(subscribe, () => connection.status);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Testtisch');
  const [stack, setStack] = useState('1500');
  const [turn, setTurn] = useState('20');

  useEffect(() => {
    let created: number | null = null;
    const offMessage = connection.onMessage((m: ServerMessage) => {
      // Gleich Platz nehmen und erst dann weiter: so landet man am Tisch auf dem eigenen Sitz.
      if (m.type === 'table.created' && m.requestId === 'dev-create') {
        created = m.tableId;
        connection.send({ type: 'table.sit', tableId: m.tableId, seat: 0 });
      }
      if (m.type === 'table.state' && m.table.id === created && m.table.you.seat !== null) {
        void navigate(`/table/${String(m.table.id)}`);
      }
      if (m.type === 'error') setError(m.message);
    });
    return offMessage;
  }, [connection, navigate]);

  return (
    <form
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        maxWidth: 360,
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const sent = connection.send({
          type: 'table.create',
          requestId: 'dev-create',
          settings: { name, startingStack: Number(stack), turnTimeSeconds: Number(turn) },
        });
        if (!sent) setError('Nicht verbunden');
      }}
    >
      <h1 style={{ fontSize: 'var(--font-size-lg)' }}>Dev: Tisch anlegen</h1>
      <label>
        Name{' '}
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <label>
        Startstack{' '}
        <input
          inputMode="numeric"
          value={stack}
          onChange={(e) => {
            setStack(e.target.value);
          }}
        />
      </label>
      <label>
        Zugzeit (s){' '}
        <input
          inputMode="numeric"
          value={turn}
          onChange={(e) => {
            setTurn(e.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={status.kind !== 'open'}>
        Tisch anlegen
      </button>
      <p data-testid="dev-status">Verbindung: {status.kind}</p>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}
