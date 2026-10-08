// Bausteine der Spielseite (WP-018): Verbindungshinweis, Fehlermeldung, Inhalte des Aktionsbereichs
// (Warten auf Start, Aktionsleiste, Showdown) und Rundenende-Dialog.
import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import type { StandingView, TableClosedMessage, TableView as ServerTableView } from '@poker/engine/protocol';
import { ActionBar } from '../table/actions/ActionBar';
import { formatChips } from '../table/format';
import { heroHandContext } from './adapter';
import type { ConnectionStatus } from './connection';
import { useNow } from './hooks';
import { describePotResult, handResult, standingRows } from './results';
import type { GameError, TableGameSnapshot, TableGameStore } from './tableGame';

// ---------------------------------------------------------------------------
// Verbindung
// ---------------------------------------------------------------------------

/** Hinweis bei fehlender Verbindung; bei offener Verbindung nichts. */
export function ConnectionBanner({
  status,
  hasState,
  onReconnect,
}: {
  status: ConnectionStatus;
  /** Gibt es schon einen Tischzustand? (sonst „Verbinde …“ statt „unterbrochen“) */
  hasState: boolean;
  onReconnect: () => void;
}) {
  const now = useNow(status.kind === 'waiting', 500);
  if (status.kind === 'open' || status.kind === 'closed') return null;

  let text: string;
  let action: { label: string; onClick: () => void } | null = null;
  let link: { label: string; to: string } | null = null;
  switch (status.kind) {
    case 'connecting':
      text = hasState || status.attempt > 1 ? 'Verbindung wird wiederhergestellt …' : 'Verbinde …';
      break;
    case 'waiting': {
      const seconds = Math.max(0, Math.ceil((status.retryAt - now) / 1000));
      text = `Verbindung unterbrochen – neuer Versuch in ${String(seconds)} s`;
      action = { label: 'Jetzt verbinden', onClick: onReconnect };
      break;
    }
    case 'replaced':
      text = 'Der Tisch ist in einem anderen Tab oder auf einem anderen Gerät geöffnet.';
      action = { label: 'Hier weiterspielen', onClick: onReconnect };
      break;
    case 'failed':
      text = status.message;
      if (status.reason === 'version') {
        action = {
          label: 'Neu laden',
          onClick: () => {
            window.location.reload();
          },
        };
      } else {
        link = { label: 'Anmelden', to: '/login' };
      }
      break;
  }
  return (
    <div className="gp-banner" role="status" data-testid="connection-banner" data-status={status.kind}>
      <span className="gp-banner-text">{text}</span>
      {action !== null && (
        <button type="button" className="gp-btn gp-btn--small" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {link !== null && (
        <Link className="gp-btn gp-btn--small" to={link.to}>
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** Fehlermeldung des Servers (deutsch), verschwindet nach ein paar Sekunden. */
export function ErrorToast({ error, onDismiss }: { error: GameError | null; onDismiss: () => void }) {
  useEffect(() => {
    if (error === null) return undefined;
    const id = setTimeout(onDismiss, 4000);
    return () => {
      clearTimeout(id);
    };
  }, [error, onDismiss]);
  if (error === null) return null;
  return (
    <div className="gp-toast" role="alert" data-testid="game-error" data-code={error.code}>
      <span>{error.message}</span>
      <button type="button" className="gp-toast-close" aria-label="Meldung schließen" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aktionsbereich
// ---------------------------------------------------------------------------

function firstFreeSeat(table: ServerTableView): number | null {
  const taken = new Set(table.seats.map((s) => s.seat));
  for (let seat = 0; seat < table.settings.maxSeats; seat++) if (!taken.has(seat)) return seat;
  return null;
}

/** Vor dem Start: Platz nehmen/aufstehen, Ersteller startet die Runde. */
function WaitingPanel({
  table,
  store,
  disabled,
}: {
  table: ServerTableView;
  store: TableGameStore;
  disabled: boolean;
}) {
  const free = firstFreeSeat(table);
  const seated = table.seats.length;
  return (
    <div className="gp-panel" data-testid="waiting-panel">
      <p className="gp-panel-text">
        Warte auf den Start · {seated}/{table.settings.maxSeats} Spieler
      </p>
      <div className="gp-panel-row">
        {table.you.seat === null ? (
          <button
            type="button"
            className="gp-btn"
            disabled={disabled || free === null}
            onClick={() => {
              if (free !== null) store.sit(free);
            }}
          >
            Platz nehmen
          </button>
        ) : (
          <button
            type="button"
            className="gp-btn gp-btn--muted"
            disabled={disabled}
            onClick={() => {
              store.stand();
            }}
          >
            Aufstehen
          </button>
        )}
        {table.you.isCreator && (
          <button
            type="button"
            className="gp-btn gp-btn--primary"
            disabled={disabled || seated < 2}
            onClick={() => {
              store.startRound();
            }}
          >
            Runde starten
          </button>
        )}
      </div>
    </div>
  );
}

/** Showdown bzw. Ende der Hand: wer was womit gewonnen hat. */
function HandResultPanel({ table }: { table: ServerTableView }) {
  return (
    <div className="gp-panel gp-panel--result" aria-live="polite">
      <HandResultList table={table} />
    </div>
  );
}

function HandResultList({ table }: { table: ServerTableView }) {
  const result = handResult(table);
  if (result === null) return null;
  return (
    <div className="gp-result" data-testid="hand-result">
      <ul className="gp-result-list">
        {result.lines.map((line, i) => (
          <li key={i} className="gp-result-line">
            {result.lines.length > 1 && <span className="gp-result-label">{line.label}: </span>}
            {describePotResult(line)}
          </li>
        ))}
      </ul>
      {result.ownHand !== null && <p className="gp-panel-text gp-muted">Deine Hand: {result.ownHand}</p>}
    </div>
  );
}

function InfoPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="gp-panel" data-testid="info-panel">
      <p className="gp-panel-text gp-muted">{children}</p>
    </div>
  );
}

/** Inhalt des `actionBar`-Bereichs je nach Tisch- und Handzustand. */
export function GameActionArea({ snapshot, store }: { snapshot: TableGameSnapshot; store: TableGameStore }) {
  const table = snapshot.table;
  if (table === null) return null;
  const disconnected = snapshot.connection.kind !== 'open';

  if (table.status === 'open') return <WaitingPanel table={table} store={store} disabled={disconnected} />;
  if (table.status === 'finished') {
    return (
      <div className="gp-panel" data-testid="finished-panel">
        {/* Letzte Hand der Runde (Showdown) bleibt sichtbar; das Rundenergebnis zeigt der Dialog. */}
        {handResult(table) === null ? (
          <p className="gp-panel-text">Die Runde ist beendet.</p>
        ) : (
          <HandResultList table={table} />
        )}
        <div className="gp-panel-row">
          <button
            type="button"
            className="gp-btn"
            onClick={() => {
              store.showStandings();
            }}
          >
            Ergebnis
          </button>
          {table.you.isCreator && (
            <button
              type="button"
              className="gp-btn gp-btn--primary"
              disabled={disconnected}
              onClick={() => {
                store.rematch();
              }}
            >
              Nochmal
            </button>
          )}
          <Link className="gp-btn gp-btn--muted" to="/">
            Zur Lobby
          </Link>
        </div>
      </div>
    );
  }

  const hand = table.round?.hand ?? null;
  if (hand?.phase === 'complete') return <HandResultPanel table={table} />;

  const ctx = heroHandContext(table);
  if (ctx !== null && (ctx.canAct || ctx.legal !== null)) {
    return (
      <ActionBar
        legal={ctx.legal}
        pot={{ pot: ctx.pot, toCall: ctx.toCall, currentBet: ctx.currentBet }}
        step={1}
        disabled={disconnected || snapshot.pendingAction}
        onAction={(action) => {
          store.act(action);
        }}
        preAction={
          ctx.legal === null
            ? {
                toCall: ctx.toCall,
                selected: snapshot.preAction,
                onSelect: (choice) => {
                  store.selectPreAction(choice);
                },
              }
            : null
        }
      />
    );
  }
  if (table.you.seat === null) return <InfoPanel>Du schaust zu.</InfoPanel>;
  const me = table.round?.players.find((p) => p.id === String(table.you.userId));
  if (me?.placement !== null && me?.placement !== undefined && me.stack === 0) {
    return <InfoPanel>Du bist ausgeschieden (Platz {me.placement}).</InfoPanel>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rundenende
// ---------------------------------------------------------------------------

/** Dialog mit Platzierungen und Punkten (D-012), geteilte Plätze als Bereich (D-018). */
export function RoundResultDialog({
  standings,
  youUserId,
  onClose,
  onRematch = null,
  away = [],
}: {
  standings: readonly StandingView[];
  youUserId: number | null;
  onClose: () => void;
  /** „Nochmal“ (D-020) – nur für den Ersteller nach Rundenende; `null` = kein Knopf. */
  onRematch?: (() => void) | null;
  /** Getrennte Spieler am Tisch – stehen bei „Nochmal“ automatisch auf (D-024); Hinweis nur beim Knopf. */
  away?: readonly string[];
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const rows = standingRows(standings, youUserId);
  const winner = rows[0];
  return (
    <div className="gp-overlay">
      <div className="gp-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="round-result">
        <h2 id={titleId} className="gp-dialog-title">
          Runde beendet
        </h2>
        {winner !== undefined && (
          <p className="gp-panel-text">{winner.isYou ? 'Du hast gewonnen!' : `${winner.name} hat gewonnen.`}</p>
        )}
        <table className="gp-standings">
          <thead>
            <tr>
              <th scope="col">Platz</th>
              <th scope="col">Spieler</th>
              <th scope="col">Punkte</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={r.isYou ? 'gp-standings-you' : undefined} data-testid="standing">
                <td>
                  {r.place}
                  {r.shared && <span className="gp-muted"> (geteilt)</span>}
                </td>
                <td>{r.name}</td>
                <td>{formatChips(r.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {onRematch !== null && away.length > 0 && (
          <p className="gp-panel-text gp-muted" data-testid="rematch-away">
            Nicht verbunden, spielt bei „Nochmal“ nicht mit: {away.join(', ')}
          </p>
        )}
        <div className="gp-panel-row">
          <button ref={closeRef} type="button" className="gp-btn gp-btn--muted" onClick={onClose}>
            Schließen
          </button>
          {onRematch === null ? (
            <Link className="gp-btn gp-btn--primary" to="/">
              Zur Lobby
            </Link>
          ) : (
            <>
              <Link className="gp-btn gp-btn--muted" to="/">
                Zur Lobby
              </Link>
              <button type="button" className="gp-btn gp-btn--primary" onClick={onRematch}>
                Nochmal
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tisch vom Server geschlossen (verwaiste Runde, D-022, oder Admin, WP-028): Hinweis, nach kurzer Zeit zur Lobby. */
export function TableClosedNotice({
  reason = 'abandoned',
  onBack,
}: {
  reason?: TableClosedMessage['reason'];
  onBack: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onBack, 5000);
    return () => {
      clearTimeout(id);
    };
  }, [onBack]);
  return (
    <div className="gp-center" role="alert" data-testid="table-closed">
      <p>
        {reason === 'admin'
          ? 'Ein Admin hat den Tisch geschlossen – die Runde zählt nicht.'
          : 'Runde abgebrochen – niemand war mehr da.'}
      </p>
      <button type="button" className="gp-btn gp-btn--primary" onClick={onBack}>
        Zur Lobby
      </button>
    </div>
  );
}
