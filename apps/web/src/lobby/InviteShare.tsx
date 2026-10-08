// Einladungslink eines privaten Tisches anzeigen, teilen (Web Share API) oder kopieren (WP-015).
// Wiederverwendbar, z. B. im Tisch-Menü (WP-018).
import { useId, useRef, useState } from 'react';
import { copyInvite, inviteUrl, shareInvite, type ShareResult } from './invite';
import styles from './Lobby.module.css';

const MESSAGES: Record<ShareResult, string | null> = {
  shared: null,
  cancelled: null,
  copied: 'Link kopiert',
  manual: 'Kopieren nicht möglich – bitte den Link markieren und kopieren',
};

export function InviteShare({ inviteCode, tableName }: { inviteCode: string; tableName: string }) {
  const id = useId();
  const url = inviteUrl(inviteCode);
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canShare = typeof navigator.share === 'function';

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
        <button type="button" className={styles.secondary} onClick={() => void copyInvite(url).then(show)}>
          Link kopieren
        </button>
      </div>
      <p className={styles.success} role="status">
        {message}
      </p>
    </div>
  );
}
