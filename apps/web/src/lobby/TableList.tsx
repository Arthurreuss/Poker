// Liste der öffentlichen Tische (WP-015), live über `lobby.snapshot`/`lobby.update`/`lobby.remove`.
import type { LobbyTable } from '@poker/engine/protocol';
import { formatBlinds, formatNumber } from './tableSettingsForm';
import styles from './Lobby.module.css';

const STATUS_LABEL: Record<LobbyTable['status'], string> = { open: 'Offen', running: 'Läuft' };

export function TableList({ tables, onOpen }: { tables: readonly LobbyTable[]; onOpen: (tableId: number) => void }) {
  if (tables.length === 0) {
    return <p className={styles.empty}>Gerade ist kein öffentlicher Tisch offen. Erstelle doch einen!</p>;
  }
  return (
    <ul className={styles.list} aria-label="Offene Tische">
      {tables.map((t) => {
        const canSit = t.status === 'open' && t.seated < t.maxSeats;
        return (
          <li key={t.id} className={styles.table} data-table-id={t.id}>
            <div className={styles.tableInfo}>
              <span className={styles.tableName}>{t.name}</span>
              <ul className={styles.facts}>
                <li>
                  <span className={styles.badge} data-status={t.status}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </li>
                <li>
                  {t.seated}/{t.maxSeats} Spieler
                </li>
                <li>
                  Blinds {formatBlinds(t.blinds)} {t.blindType === 'increasing' ? '(steigend)' : '(fest)'}
                </li>
                <li>Stack {formatNumber(t.startingStack)}</li>
                <li>
                  {t.turnTimeSeconds} s + {t.timeBankSeconds} s Zeitbank
                </li>
                <li>von {t.createdBy.username}</li>
              </ul>
            </div>
            <button
              type="button"
              className={canSit ? styles.primary : styles.secondary}
              aria-label={`${canSit ? 'Beitreten' : 'Zuschauen'}: ${t.name}`}
              onClick={() => {
                onOpen(t.id);
              }}
            >
              {canSit ? 'Beitreten' : 'Zuschauen'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
