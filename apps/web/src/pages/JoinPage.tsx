// Einladungsseite /join/:code (WP-015): tritt per Einladungscode bei und leitet zur Tischseite weiter.
// Danach darf der User den privaten Tisch auch per tableId betreten (Server merkt sich den Beitritt).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LobbyRequestError } from '../lobby/client';
import { ConnectionNotice } from '../lobby/ConnectionStatus';
import { useLobby } from '../lobby/useLobby';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

export function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { client, state } = useLobby({ subscribe: false });
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (state.status !== 'online' || tried.current) return;
    tried.current = true;
    client.joinByInvite(code).then(
      (tableId) => {
        void navigate(`/table/${String(tableId)}`, { replace: true });
      },
      (err: unknown) => {
        if (err instanceof LobbyRequestError && err.code === 'DISCONNECTED') {
          tried.current = false; // nach dem Reconnect erneut versuchen
          return;
        }
        setError('Diese Einladung ist ungültig oder der Tisch existiert nicht mehr.');
      },
    );
  }, [client, code, navigate, state.status]);

  return (
    <PlaceholderPage title="Einladung">
      <ConnectionNotice
        status={state.status}
        onReconnect={() => {
          client.reconnect();
        }}
      />
      {error === null ? (
        <p className={styles.muted} role="status">
          Tisch wird geöffnet …
        </p>
      ) : (
        <>
          <p role="alert">{error}</p>
          <Link to="/">Zur Lobby</Link>
        </>
      )}
    </PlaceholderPage>
  );
}
