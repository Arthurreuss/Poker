// Spielseite eines Tisches (WP-018): verbindet Store/Verbindung mit der Tischansicht (WP-016/017),
// Aktionsleiste, Showdown, Rundenende und Verbindungshinweis. Layout (Hoch/Quer) macht `TableScreen`.
import { useCallback, useMemo } from 'react';
import { Link } from 'react-router';
import type { ReactionId } from '@poker/engine/protocol';
import { useFeedbackDialog } from '../feedback';
import { DATENSCHUTZ_PATH, IMPRESSUM_PATH } from '../legal/LegalFooter';
import { invitePath, tablePath } from '../lobby/invite';
import { InviteShare } from '../lobby/InviteShare';
import { ReactionPicker } from '../reactions/ReactionPicker';
import { useAnimationsPreference } from '../settings/animations';
import { useReactionsPreference } from '../settings/reactions';
import { cx } from '../styles/cx';
import { useTableSounds } from '../sound/tableSounds';
import { TableFx } from '../table/fx/TableFx';
import type { CardReveal } from '../table/RevealableCards';
import { TableScreen } from '../table/TableScreen';
import { toReactionViews, toTableView } from './adapter';
import { ConnectionBanner, ErrorToast, GameActionArea, RoundResultDialog, TableClosedNotice } from './GamePanels';
import { useNow } from './hooks';
import { useHandReveal } from './presentation';
import { useRoundEndHold } from './roundEndHold';
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
  // WP-031: Runout Straße für Straße, Ergebnis danach; Showdown vor dem Rundenende-Dialog.
  const { reveal, resultShown } = useHandReveal(table?.round?.hand ?? null);
  const roundEnd = useRoundEndHold(table?.status ?? null, resultShown);
  const baseView = useMemo(
    () => (table === null ? null : toTableView(table, { turnClock, nowMs: now, reveal })),
    // `turnClock` wird je Render neu berechnet; er hängt nur von `table` und der Empfangszeit ab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, snapshot.receivedAtMs, now, reveal],
  );
  // Reaktionen nur, wenn eingeschaltet (WP-032); senden dürfen nur Spieler mit Platz.
  const view = useMemo(
    () =>
      baseView === null || !reactionsOn
        ? baseView
        : { ...baseView, reactions: toReactionViews(snapshot.reactions, baseView) },
    [baseView, reactionsOn, snapshot.reactions],
  );
  useTableSounds(view);
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
  const canReact = reactionsOn && table !== null && table.you.seat !== null;
  // Admin am Tisch (WP-033, D-027): verdeckte Karten der Mitspieler per Tipp umdrehen.
  const adminSeated = snapshot.isAdmin && table !== null && table.you.seat !== null;
  const { reveal: revealState } = snapshot;
  const cardReveal = useMemo<CardReveal | undefined>(
    () =>
      adminSeated
        ? {
            cards: revealState.cards,
            faceUp: revealState.faceUp,
            onToggle: (seat) => {
              store.toggleReveal(seat);
            },
          }
        : undefined,
    [adminSeated, revealState, store],
  );

  return (
    <div
      className={cx('gp-page', 'safe-area', animations && 'pg-anim')}
      data-testid="game-table"
      onPointerDownCapture={roundEnd.holding ? roundEnd.skip : undefined}
      onKeyDownCapture={roundEnd.holding ? roundEnd.skip : undefined}
    >
      <ConnectionBanner status={snapshot.connection} hasState={table !== null} onReconnect={reconnect} />
      {snapshot.closed !== null ? (
        <TableClosedNotice reason={snapshot.closed} onBack={onLeave} />
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
            overlay={<TableFx view={view} enabled={animations} />}
            reactionPicker={canReact ? <ReactionPicker onReact={react} /> : undefined}
            actionBar={<GameActionArea snapshot={snapshot} store={store} showResult={resultShown} />}
            reveal={cardReveal}
            menuItems={
              <div className="gp-menu-items">
                <p className="gp-menu-info">{table.settings.name}</p>
                {/* Öffentlich: Link direkt zum Tisch; privat: Einladungslink (WP-030). */}
                <div className="gp-menu-invite" aria-label="Einladen" role="group">
                  <p className="gp-menu-heading">Einladen</p>
                  <InviteShare
                    path={table.settings.isPublic ? tablePath(table.id) : invitePath(table.inviteCode)}
                    tableName={table.settings.name}
                  />
                </div>
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
      {snapshot.standings !== null && !roundEnd.holding && (
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
