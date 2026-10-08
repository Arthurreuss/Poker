// Lobby (WP-015): öffentliche Tische live, Tisch erstellen, Einladungslink für private Tische.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { TableSettings } from '@poker/engine/protocol';
import { useAuth } from '../auth/AuthContext';
import { ConnectionNotice, ConnectionStatus } from '../lobby/ConnectionStatus';
import { CreateTableForm } from '../lobby/CreateTableForm';
import { invitePath } from '../lobby/invite';
import { InviteShare } from '../lobby/InviteShare';
import styles from '../lobby/Lobby.module.css';
import { TableList } from '../lobby/TableList';
import { useLobby } from '../lobby/useLobby';
import pageStyles from './Page.module.css';

interface CreatedPrivate {
  tableId: number;
  inviteCode: string;
  name: string;
}

export function LobbyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { client, state } = useLobby();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedPrivate | null>(null);

  const openTable = (tableId: number) => {
    void navigate(`/table/${String(tableId)}`);
  };

  async function create(settings: TableSettings) {
    const { tableId, inviteCode } = await client.createTable(settings);
    if (settings.isPublic) {
      openTable(tableId);
      return;
    }
    setCreating(false);
    setCreated({ tableId, inviteCode, name: settings.name });
  }

  return (
    <section className={pageStyles.page}>
      <div className={styles.header}>
        <h1 className={pageStyles.title}>Lobby</h1>
        <ConnectionStatus status={state.status} />
      </div>
      <p className={pageStyles.muted}>Hallo {user?.username}! Setz dich an einen Tisch oder erstelle einen eigenen.</p>
      <ConnectionNotice
        status={state.status}
        onReconnect={() => {
          client.reconnect();
        }}
      />

      {created !== null && (
        <div className={styles.invite} aria-label="Privater Tisch erstellt" role="region">
          <h2 className={styles.sectionTitle}>Privater Tisch „{created.name}“ erstellt</h2>
          <p className={pageStyles.muted}>Nur wer den Link hat, kann beitreten.</p>
          <InviteShare path={invitePath(created.inviteCode)} tableName={created.name} />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                openTable(created.tableId);
              }}
            >
              Zum Tisch
            </button>
          </div>
        </div>
      )}

      {creating ? (
        <CreateTableForm
          username={user?.username}
          disabled={state.status !== 'online'}
          onSubmit={create}
          onCancel={() => {
            setCreating(false);
          }}
        />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setCreated(null);
              setCreating(true);
            }}
          >
            Tisch erstellen
          </button>
        </div>
      )}

      <h2 className={styles.sectionTitle}>Offene Tische</h2>
      {state.status === 'connecting' && state.tables.length === 0 ? (
        <p className={styles.empty}>Tische werden geladen …</p>
      ) : (
        <TableList tables={state.tables} onOpen={openTable} />
      )}
    </section>
  );
}
