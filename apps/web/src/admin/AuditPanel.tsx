// /admin/audit (WP-029): Admin-Protokoll (D-029), neueste zuerst, „Ältere laden“ blättert per `before`.
import { useState } from 'react';
import { AUDIT_PAGE_SIZE, listAudit, type AuditEntry } from '../api/admin';
import { LoadState, errorText, formatDateTime, useLoad } from './common';
import styles from './Dashboard.module.css';

/** Bekannte Aktionen; unbekannte (künftige) Codes erscheinen roh. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'user.ban': 'Spieler gesperrt',
  'user.unban': 'Sperre aufgehoben',
  'user.sessions_revoke': 'Anmeldungen beendet',
  'user.password_reset': 'Passwort zurückgesetzt',
  'user.admin_grant': 'Admin-Recht vergeben',
  'user.admin_revoke': 'Admin-Recht entzogen',
  'table.close': 'Tisch geschlossen',
  'table.reveal_cards': 'Karten aufgedeckt',
};

const SOURCE_LABELS: Record<AuditEntry['source'], string> = { api: 'Web', cli: 'CLI', ws: 'Tisch' };

function describe(entry: AuditEntry): string {
  const parts: string[] = [AUDIT_ACTION_LABELS[entry.action] ?? entry.action];
  if (entry.targetUser !== null) parts.push(entry.targetUser.username);
  if (entry.targetTableId !== null) parts.push(`Tisch #${String(entry.targetTableId)}`);
  return parts.join(' · ');
}

function Entry({ entry }: { entry: AuditEntry }) {
  const reason = typeof entry.details['reason'] === 'string' ? entry.details['reason'] : null;
  return (
    <li className={styles.audit}>
      <span className={styles.auditText}>
        <strong>{describe(entry)}</strong>
      </span>
      {reason !== null && <span className={styles.auditText}>Begründung: {reason}</span>}
      <span className={styles.muted}>
        <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time> · von{' '}
        {entry.admin?.username ?? (entry.source === 'cli' ? 'CLI' : 'gelöschtem Account')} ·{' '}
        {SOURCE_LABELS[entry.source]}
      </span>
    </li>
  );
}

export function AuditPanel() {
  const { load, reload } = useLoad((signal) => listAudit(null, signal), 'audit');
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const first = load.kind === 'ready' ? load.data : [];
  const entries = [...first, ...older];
  const more = hasMore ?? first.length === AUDIT_PAGE_SIZE;

  const loadMore = async () => {
    const last = entries.at(-1);
    if (last === undefined) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await listAudit(last.id);
      setOlder((prev) => [...prev, ...page]);
      setHasMore(page.length === AUDIT_PAGE_SIZE);
    } catch (err) {
      setMoreError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="admin-audit-title">
      <div className={styles.sectionHead}>
        <h2 id="admin-audit-title" className={styles.title}>
          Protokoll
        </h2>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            setOlder([]);
            setHasMore(null);
            reload();
          }}
        >
          Aktualisieren
        </button>
      </div>
      {/* Speicherdauer D-025, Löschjob: apps/server/src/admin/audit.ts */}
      <p className={styles.muted}>Jede Admin-Aktion steht hier. Einträge werden nach 1 Jahr automatisch gelöscht.</p>
      <LoadState load={load} />
      {load.kind === 'ready' &&
        (entries.length === 0 ? (
          <p className={styles.muted}>Noch keine Einträge.</p>
        ) : (
          <ul className={styles.list} aria-label="Einträge">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>
        ))}
      {moreError !== null && (
        <p role="alert" className={styles.alert}>
          {moreError}
        </p>
      )}
      {load.kind === 'ready' && more && (
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} onClick={() => void loadMore()}>
            {busy ? 'Laden …' : 'Ältere laden'}
          </button>
        </div>
      )}
    </section>
  );
}
