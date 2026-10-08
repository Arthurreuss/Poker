// Nur im Dev-Build (`/dev/new-table`, WP-018): Tisch direkt per WebSocket anlegen, solange es die Lobby
// (WP-015) noch nicht gibt – für manuelle Tests und den Playwright-Test mit mehreren Browsern.
// Der Ersteller sitzt danach auf Platz 1 (Sitz 0).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ServerMessage } from '@poker/engine/protocol';
import { GameConnection, type ConnectionStatus } from '../connection';

export function DevNewTablePage() {
  const navigate = useNavigate();
  const [connection] = useState(() => new GameConnection());
  const [status, setStatus] = useState<ConnectionStatus>(connection.status);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Testtisch');
  const [stack, setStack] = useState('1500');
  const [turn, setTurn] = useState('20');

  useEffect(() => {
    const offStatus = connection.onStatus(setStatus);
    const offMessage = connection.onMessage((m: ServerMessage) => {
      // Gleich Platz nehmen: ein offener Tisch ohne Spieler und ohne Zuschauer wird vom Server
      // aufgeräumt – beim Seitenwechsel ist diese Verbindung kurz weg. Weiter erst, wenn man sitzt.
      if (m.type === 'table.created' && m.requestId === 'dev-create') {
        connection.send({ type: 'table.sit', tableId: m.tableId, seat: 0 });
      }
      if (m.type === 'table.state' && m.table.you.seat !== null) {
        void navigate(`/table/${String(m.table.id)}`);
      }
      if (m.type === 'error') setError(m.message);
    });
    connection.start();
    return () => {
      offStatus();
      offMessage();
      connection.stop();
    };
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
