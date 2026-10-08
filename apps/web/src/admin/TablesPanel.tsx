// /admin/tables (WP-029): Tische im Speicher mit Spielern und Verbindungsstatus; „Schließen“ mit Bestätigung
// (laufende Runde wird ohne Punkte abgebrochen, D-029). Lädt alle 30 s neu.
import { useEffect, useState } from 'react';
import { closeAdminTable, listAdminTables, type AdminTable } from '../api/admin';
import { ConfirmDialog, LoadState, errorText, useLoad } from './common';
import styles from './Dashboard.module.css';
import { OVERVIEW_REFRESH_MS } from './OverviewPanel';

const STATUS_LABELS: Record<AdminTable['status'], string> = {
  open: 'Offen',
  running: 'Läuft',
  finished: 'Beendet',
};

function TableCard({ table, onClose }: { table: AdminTable; onClose: () => void }) {
  const titleId = `admin-table-${String(table.id)}`;
  return (
    <li className={styles.card} data-state={table.status} aria-labelledby={titleId}>
      <div className={styles.cardHead}>
        <h3 id={titleId} className={styles.cardTitle}>
          {table.name}
        </h3>
        <span className={styles.badge} data-kind={table.status}>
          {STATUS_LABELS[table.status]}
        </span>
        {!table.isPublic && <span className={styles.badge}>Privat</span>}
      </div>
      <p className={styles.muted}>
        Tisch #{table.id} · von {table.createdBy.username} · {table.players.length}/{table.maxSeats} Plätze ·{' '}
        {table.watchers} verbunden
        {table.handNumber === null ? '' : ` · Hand ${String(table.handNumber)}`}
      </p>
      {table.players.length > 0 && (
        <ul className={styles.players} aria-label={`Spieler an ${table.name}`}>
          {table.players.map((p) => (
            <li key={p.id}>
              <span className={styles.dot} data-on={p.connected} aria-hidden="true" />
              {p.username}
              <span className={styles.muted}>{p.connected ? '' : ' (getrennt)'}</span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.danger} onClick={onClose}>
          Tisch schließen
        </button>
      </div>
    </li>
  );
}

export function TablesPanel() {
  const { load, reload } = useLoad((signal) => listAdminTables(signal), 'tables');
  const [confirm, setConfirm] = useState<AdminTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(reload, OVERVIEW_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [reload]);

  const close = async (table: AdminTable) => {
    setBusy(true);
    setDialogError(null);
    try {
      const result = await closeAdminTable(table.id);
      setNotice(
        `„${table.name}“ geschlossen${result.roundAborted ? ' – die laufende Runde wurde ohne Punkte abgebrochen' : ''}.`,
      );
      setConfirm(null);
      reload();
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="admin-tables-title">
      <div className={styles.sectionHead}>
        <h2 id="admin-tables-title" className={styles.title}>
          Tische
        </h2>
        <button type="button" className={styles.button} onClick={reload}>
          Aktualisieren
        </button>
      </div>
      {notice !== null && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <LoadState load={load} />
      {load.kind === 'ready' &&
        (load.data.length === 0 ? (
          <p className={styles.muted}>Gerade ist kein Tisch offen.</p>
        ) : (
          <ul className={styles.list}>
            {load.data.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                onClose={() => {
                  setDialogError(null);
                  setConfirm(table);
                }}
              />
            ))}
          </ul>
        ))}
      {confirm !== null && (
        <ConfirmDialog
          title={`„${confirm.name}“ schließen?`}
          confirmLabel="Tisch schließen"
          danger
          busy={busy}
          error={dialogError}
          onConfirm={() => {
            void close(confirm);
          }}
          onCancel={() => {
            setConfirm(null);
          }}
        >
          <p>
            {confirm.status === 'running'
              ? 'Die laufende Runde wird sofort abgebrochen und zählt nicht (keine Punkte).'
              : 'Der Tisch verschwindet aus der Lobby.'}{' '}
            Alle am Tisch sehen „Ein Admin hat den Tisch geschlossen“. Die Aktion steht im Admin-Protokoll.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
