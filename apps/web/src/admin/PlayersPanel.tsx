// /admin/players (WP-029): Spielerliste mit Suche; Sperren/Entsperren, Sessions beenden und Passwort zurücksetzen,
// jeweils mit Bestätigung. Das neue Passwort steht genau einmal im Dialog (mit Kopier-Knopf) und wird nirgends
// gespeichert (D-029). Admins und man selbst sind nicht sperrbar – der Server prüft das ebenfalls.
import { useEffect, useState } from 'react';
import {
  banAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  revokeAdminUserSessions,
  unbanAdminUser,
  type AdminUser,
} from '../api/admin';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog, LoadState, Modal, dateFormat, errorText, formatDateTime, useLoad } from './common';
import styles from './Dashboard.module.css';

export const SEARCH_DEBOUNCE_MS = 300;
/** Wie `BAN_REASON_MAX` im Server. */
export const BAN_REASON_MAX = 500;

type Action = 'ban' | 'unban' | 'sessions' | 'password';

const ACTION_TITLES: Record<Action, (name: string) => string> = {
  ban: (n) => `${n} sperren?`,
  unban: (n) => `Sperre von ${n} aufheben?`,
  sessions: (n) => `Alle Anmeldungen von ${n} beenden?`,
  password: (n) => `Passwort von ${n} zurücksetzen?`,
};

const ACTION_LABELS: Record<Action, string> = {
  ban: 'Sperren',
  unban: 'Entsperren',
  sessions: 'Abmelden',
  password: 'Passwort zurücksetzen',
};

function PlayerCard({
  player,
  isSelf,
  onAction,
}: {
  player: AdminUser;
  isSelf: boolean;
  onAction: (action: Action) => void;
}) {
  const banned = player.bannedAt !== null;
  const titleId = `admin-player-${String(player.id)}`;
  return (
    <li className={styles.card} data-state={banned ? 'banned' : 'active'} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          {player.username}
        </h3>
        {player.isAdmin && (
          <span className={styles.badge} data-kind="admin">
            Admin
          </span>
        )}
        {isSelf && <span className={styles.badge}>Du</span>}
        {banned && (
          <span className={styles.badge} data-kind="banned">
            Gesperrt
          </span>
        )}
      </div>
      <p className={styles.muted}>
        Seit {dateFormat.format(new Date(player.createdAt))} · {player.sessions}{' '}
        {player.sessions === 1 ? 'Anmeldung' : 'Anmeldungen'}
        {player.bannedAt === null ? '' : ` · gesperrt am ${formatDateTime(player.bannedAt)}`}
      </p>
      <div className={styles.actions}>
        {banned ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onAction('unban');
            }}
          >
            Entsperren
          </button>
        ) : (
          !isSelf &&
          !player.isAdmin && (
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                onAction('ban');
              }}
            >
              Sperren
            </button>
          )
        )}
        {player.sessions > 0 && (
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              onAction('sessions');
            }}
          >
            Abmelden
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            onAction('password');
          }}
        >
          Passwort zurücksetzen
        </button>
      </div>
    </li>
  );
}

function PasswordDialog({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  // Nur „Fertig“ schließt – ein versehentlicher Tipp daneben soll das einmalige Passwort nicht verwerfen.
  return (
    <Modal onClose={() => undefined}>
      {(titleId, initialFocus) => (
        <>
          <h2 id={titleId} className={styles.dialogTitle}>
            Neues Passwort für {username}
          </h2>
          <p>
            Das Passwort wird <strong>nur jetzt</strong> angezeigt. Gib es {username} auf sicherem Weg weiter; alle
            bisherigen Anmeldungen sind beendet.
          </p>
          <code className={styles.password} data-testid="reset-password">
            {password}
          </code>
          {copied === 'ok' && (
            <p role="status" className={styles.muted}>
              In die Zwischenablage kopiert.
            </p>
          )}
          {copied === 'failed' && (
            <p role="alert" className={styles.alert}>
              Kopieren ging nicht – bitte von Hand markieren und kopieren.
            </p>
          )}
          <div className={styles.dialogActions}>
            <button ref={initialFocus} type="button" className={styles.primary} onClick={() => void copy()}>
              Kopieren
            </button>
            <button type="button" className={styles.button} onClick={onClose}>
              Fertig
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function PlayersPanel() {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const { load, reload } = useLoad((signal) => listAdminUsers(search, signal), search);
  const [pending, setPending] = useState<{ player: AdminUser; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState<{ username: string; password: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(input.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [input]);

  const run = async (player: AdminUser, action: Action) => {
    setBusy(true);
    setDialogError(null);
    try {
      if (action === 'ban') {
        await banAdminUser(player.id, reason);
        setNotice(`${player.username} ist gesperrt und wurde abgemeldet.`);
      } else if (action === 'unban') {
        await unbanAdminUser(player.id);
        setNotice(`${player.username} ist wieder entsperrt.`);
      } else if (action === 'sessions') {
        const revoked = await revokeAdminUserSessions(player.id);
        setNotice(`${String(revoked)} ${revoked === 1 ? 'Anmeldung' : 'Anmeldungen'} von ${player.username} beendet.`);
      } else {
        const pw = await resetAdminUserPassword(player.id);
        setNotice(null);
        setPassword({ username: player.username, password: pw });
      }
      setPending(null);
      reload();
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="admin-players-title">
      <h2 id="admin-players-title" className={styles.title}>
        Spieler
      </h2>
      <label className={styles.search}>
        <span className={styles.muted}>Suche nach Namen</span>
        <input
          type="search"
          value={input}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
      </label>
      {notice !== null && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <LoadState load={load} />
      {load.kind === 'ready' &&
        (load.data.length === 0 ? (
          <p className={styles.muted}>{search === '' ? 'Noch keine Spieler.' : `Kein Spieler mit „${search}“.`}</p>
        ) : (
          <>
            <ul className={styles.list}>
              {load.data.map((player) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  isSelf={player.id === user?.id}
                  onAction={(action) => {
                    setReason('');
                    setDialogError(null);
                    setPending({ player, action });
                  }}
                />
              ))}
            </ul>
            {load.data.length >= 50 && (
              <p className={styles.muted}>Es werden höchstens 50 Spieler angezeigt – Suche eingrenzen.</p>
            )}
          </>
        ))}

      {pending !== null && (
        <ConfirmDialog
          title={ACTION_TITLES[pending.action](pending.player.username)}
          confirmLabel={ACTION_LABELS[pending.action]}
          danger={pending.action !== 'unban'}
          busy={busy}
          error={dialogError}
          onConfirm={() => {
            void run(pending.player, pending.action);
          }}
          onCancel={() => {
            setPending(null);
          }}
        >
          {pending.action === 'ban' && (
            <>
              <p>
                {pending.player.username} wird sofort abgemeldet und kann sich nicht mehr anmelden. Am Tisch wird
                automatisch gecheckt/gefoldet.
              </p>
              <label className={styles.field}>
                <span className={styles.muted}>Begründung (optional, steht im Admin-Protokoll)</span>
                <textarea
                  value={reason}
                  maxLength={BAN_REASON_MAX}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              </label>
            </>
          )}
          {pending.action === 'unban' && <p>{pending.player.username} kann sich danach wieder anmelden.</p>}
          {pending.action === 'sessions' && (
            <p>
              {pending.player.username} wird auf allen Geräten abgemeldet und muss sich neu anmelden.
              {pending.player.id === user?.id ? ' Das betrifft auch dich selbst.' : ''}
            </p>
          )}
          {pending.action === 'password' && (
            <p>
              Das alte Passwort gilt danach nicht mehr, alle Anmeldungen enden. Das neue Passwort wird nur einmal
              angezeigt.
              {pending.player.id === user?.id ? ' Das betrifft auch dich selbst.' : ''}
            </p>
          )}
        </ConfirmDialog>
      )}

      {password !== null && (
        <PasswordDialog
          username={password.username}
          password={password.password}
          onClose={() => {
            setPassword(null);
          }}
        />
      )}
    </section>
  );
}
