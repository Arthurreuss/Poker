// React-Anbindung des Lobby-Clients: hängt sich für die Dauer der Seite an die Verbindung der App.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useConnection } from '../game/ConnectionProvider';
import { LobbyClient, type LobbyState } from './client';

export function useLobby(options: { subscribe?: boolean } = {}): { client: LobbyClient; state: LobbyState } {
  const connection = useConnection();
  const subscribe = options.subscribe ?? true;
  const [client] = useState(() => new LobbyClient(connection, { subscribe }));
  useEffect(() => {
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return { client, state };
}
