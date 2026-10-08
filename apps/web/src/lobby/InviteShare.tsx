// Link zu einem Tisch anzeigen, teilen oder kopieren (WP-015, WP-030): nach dem Erstellen eines privaten Tisches
// und im Tisch-Menü. Auf Touch-Geräten mit Web Share API öffnet „Link teilen“ das Teilen-Menü des Geräts
// (WhatsApp, Signal, …), sonst ist „Link kopieren“ die Hauptaktion; die Bestätigung erscheint darunter.
import { useId, useRef, useState } from 'react';
import { canShareNatively, copyInvite, shareInvite, shareUrl, type ShareResult } from './invite';
import styles from './Lobby.module.css';

const MESSAGES: Record<ShareResult, string | null> = {
  shared: null,
  cancelled: null,
  copied: 'Link kopiert',
  manual: 'Kopieren nicht möglich – bitte den Link markieren und kopieren',
};

export interface InviteShareProps {
  /** Pfad des Links, z. B. `invitePath(code)` oder `tablePath(id)`. */
  readonly path: string;
  /** Name des Tisches für den Text im Teilen-Menü (nicht für die Link-Vorschau). */
  readonly tableName: string;
}

export function InviteShare({ path, tableName }: InviteShareProps) {
  const id = useId();
  const url = shareUrl(path);
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [canShare] = useState(() => canShareNatively());

  function show(result: ShareResult) {
    setMessage(MESSAGES[result]);
    if (result === 'manual') input.current?.select();
  }

  return (
    <div className={styles.field}>
      <label htmlFor={`${id}-link`}>Einladungslink</label>
      <input
        ref={input}
        id={`${id}-link`}
        className={styles.link}
        type="text"
        readOnly
        value={url}
        onFocus={(e) => {
          e.target.select();
        }}
      />
      <div className={styles.actions}>
        {canShare && (
          <button type="button" className={styles.primary} onClick={() => void shareInvite(url, tableName).then(show)}>
            Link teilen
          </button>
        )}
        <button
          type="button"
          className={canShare ? styles.secondary : styles.primary}
          onClick={() => void copyInvite(url).then(show)}
        >
          Link kopieren
        </button>
      </div>
      <p className={styles.success} role="status">
        {message}
      </p>
    </div>
  );
}
