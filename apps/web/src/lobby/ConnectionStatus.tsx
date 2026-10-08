// Verbindungsanzeige für Lobby und Einladungsseite (WP-015).
import type { LobbyStatus } from './client';
import styles from './Lobby.module.css';

const LABEL: Record<LobbyStatus, string> = {
  connecting: 'Verbinde …',
  online: 'Verbunden',
  replaced: 'Getrennt',
  outdated: 'Veraltet',
};

export function ConnectionStatus({ status }: { status: LobbyStatus }) {
  return (
    <span className={styles.status} role="status" aria-label={`Verbindung: ${LABEL[status]}`}>
      <span className={styles.dot} data-status={status} aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}

/** Hinweis bei 4001 (anderer Tab/Gerät) bzw. 4000 (neue Version) – dort verbindet der Client nicht selbst neu. */
export function ConnectionNotice({ status, onReconnect }: { status: LobbyStatus; onReconnect: () => void }) {
  if (status === 'replaced') {
    return (
      <div className={styles.notice} role="alert">
        <span>Poker ist in einem anderen Tab oder auf einem anderen Gerät geöffnet.</span>
        <button type="button" className={styles.secondary} onClick={onReconnect}>
          Hier weiterspielen
        </button>
      </div>
    );
  }
  if (status === 'outdated') {
    return (
      <div className={styles.notice} role="alert">
        <span>Es gibt eine neue Version.</span>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => {
            window.location.reload();
          }}
        >
          Seite neu laden
        </button>
      </div>
    );
  }
  return null;
}
