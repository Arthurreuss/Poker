// React-Anbindung des Lobby-Clients (WP-015): eine Verbindung pro Seite, beim Verlassen getrennt.
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { browserSocketFactory, LobbyClient, type LobbyState, type SocketFactory } from './client';

/** Tests ersetzen hierüber den WebSocket (`<LobbySocketContext value={fake}>`). */
export const LobbySocketContext = createContext<SocketFactory>(browserSocketFactory);

export function useLobby(options: { subscribe?: boolean } = {}): { client: LobbyClient; state: LobbyState } {
  const socketFactory = useContext(LobbySocketContext);
  const subscribe = options.subscribe ?? true;
  const [client] = useState(() => new LobbyClient({ socketFactory, subscribe }));
  useEffect(() => {
    client.start();
    return () => {
      client.stop();
    };
  }, [client]);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  return { client, state };
}
