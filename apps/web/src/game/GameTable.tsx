// Spielseite eines Tisches (WP-018): verbindet Store/Verbindung mit der Tischansicht (WP-016/017),
// Aktionsleiste, Showdown, Rundenende und Verbindungshinweis. Layout (Hoch/Quer) macht `TableScreen`.
import { useCallback } from 'react';
import { Link } from 'react-router';
import type { ReactionId } from '@poker/engine/protocol';
import { useFeedbackDialog } from '../feedback';
import { DATENSCHUTZ_PATH, IMPRESSUM_PATH } from '../legal/LegalFooter';
import { InviteShare } from '../lobby/InviteShare';
import { ReactionPicker } from '../reactions/ReactionPicker';
import { useAnimationsPreference } from '../settings/animations';
import { useReactionsPreference } from '../settings/reactions';
import { cx } from '../styles/cx';
import { TableScreen } from '../table/TableScreen';
import { toReactionViews, toTableView } from './adapter';
import { ConnectionBanner, ErrorToast, GameActionArea, RoundResultDialog, TableClosedNotice } from './GamePanels';
import { useNow } from './hooks';
import type { TableGameSnapshot, TableGameStore } from './tableGame';
import { readTurnClock } from './turnClock';
import './game.css';

export interface GameTableProps {
  readonly snapshot: TableGameSnapshot;
  readonly store: TableGameStore;
  /** Nach „Tisch verlassen“ bzw. wenn der Server den Tisch geschlossen hat (stabile Referenz). */
  readonly onLeave: () => void;
}

export function GameTable({ snapshot, store, onLeave }: GameTableProps) {
  const [animations] = useAnimationsPreference();
  const [reactionsOn] = useReactionsPreference();
  const table = snapshot.table;
  const turnClock = table === null ? null : readTurnClock(table, snapshot.receivedAtMs);
  const now = useNow(turnClock !== null, 200);
  const dismissError = useCallback(() => {
    store.dismissError();
  }, [store]);
  const closeStandings = useCallback(() => {
    store.dismissStandings();
  }, [store]);
  const reconnect = useCallback(() => {
    store.reconnectNow();
  }, [store]);
  const rematch = useCallback(() => {
    store.rematch();
  }, [store]);
  const react = useCallback((reaction: ReactionId) => store.react(reaction), [store]);
  const feedback = useFeedbackDialog({ tableId: store.tableId });
  const baseView = table === null ? null : toTableView(table, { turnClock, nowMs: now });
  // Reaktionen nur, wenn eingeschaltet (WP-032); senden dürfen nur Spieler mit Platz.
  const view =
    baseView === null || !reactionsOn
      ? baseView
      : { ...baseView, reactions: toReactionViews(snapshot.reactions, baseView) };
  const canReact = reactionsOn && table !== null && table.you.seat !== null;

  return (
    <div className={cx('gp-page', 'safe-area', animations && 'pg-anim')} data-testid="game-table">
      <ConnectionBanner status={snapshot.connection} hasState={table !== null} onReconnect={reconnect} />
      {snapshot.closed !== null ? (
        <TableClosedNotice onBack={onLeave} />
      ) : table === null || view === null ? (
        <div className="gp-center">
          {snapshot.notFound ? (
            <>
              <p>Diesen Tisch gibt es nicht (mehr).</p>
              <Link to="/">Zur Lobby</Link>
            </>
          ) : (
            <p className="gp-muted">Tisch wird geladen …</p>
          )}
        </div>
      ) : (
        <div className="gp-table">
          <TableScreen
            view={view}
            reactionPicker={canReact ? <ReactionPicker onReact={react} /> : undefined}
            actionBar={<GameActionArea snapshot={snapshot} store={store} />}
            menuItems={
              <div className="gp-menu-items">
                <p className="gp-menu-info">{table.settings.name}</p>
                {!table.settings.isPublic && (
                  <div className="gp-menu-invite" aria-label="Einladen" role="group">
                    <p className="gp-menu-heading">Einladen</p>
                    <InviteShare inviteCode={table.inviteCode} tableName={table.settings.name} />
                  </div>
                )}
                <button type="button" className="gp-btn gp-btn--muted gp-btn--block" onClick={feedback.open}>
                  Feedback senden
                </button>
                <div className="gp-menu-links">
                  <a href={IMPRESSUM_PATH} target="_blank" rel="noopener noreferrer">
                    Impressum
                  </a>
                  <a href={DATENSCHUTZ_PATH} target="_blank" rel="noopener noreferrer">
                    Datenschutz
                  </a>
                </div>
                <button
                  type="button"
                  className="gp-btn gp-btn--muted gp-btn--block"
                  onClick={() => {
                    store.leave();
                    onLeave();
                  }}
                >
                  Tisch verlassen
                </button>
              </div>
            }
          />
        </div>
      )}
      <ErrorToast error={snapshot.error} onDismiss={dismissError} />
      {snapshot.standings !== null && (
        <RoundResultDialog
          standings={snapshot.standings}
          youUserId={table?.you.userId ?? null}
          onClose={closeStandings}
          onRematch={table?.status === 'finished' && table.you.isCreator ? rematch : null}
          away={table?.seats.filter((s) => !s.connected).map((s) => s.user.username) ?? []}
        />
      )}
      {/* Außerhalb des Menü-Panels: bleibt offen, auch wenn das Menü schließt. */}
      {feedback.dialog}
    </div>
  );
}
