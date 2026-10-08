/**
 * WebSocket-Protokoll zwischen Game-Server und Web-Client (WP-011): Nachrichtentypen als diskriminierte
 * Unions über `type`. Rein (keine I/O), damit Server und Browser dieselben Typen und Validatoren nutzen.
 * Ablauf und Regeln: ARCHITECTURE.md, Abschnitt „Game-Server: Protokoll und Tische“.
 */
import type { BlindLevel, BlindStructure } from '../blind-structure';
import type { Card } from '../cards';
import type {
  Action,
  HandEvent,
  HandPhase,
  LegalActions,
  Payout,
  PlayerStatus,
  PotAward,
  ShowdownHand,
  Street,
} from '../hand-state';
import type { RoundPhase, RoundPlayer, RoundStanding } from '../round';
import type { AvatarId, ReactionId } from './avatars';

/** Version des Protokolls; der Client nennt sie in `hello`, bei Abweichung lehnt der Server ab. */
export const PROTOCOL_VERSION = 1;

/** Größte erlaubte Nachricht (Bytes); größere Frames trennt der Server (`ws` maxPayload). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Höchstlänge einer frei wählbaren `requestId` (wird in Antworten und Fehlern zurückgegeben). */
export const MAX_REQUEST_ID_LENGTH = 64;

/**
 * WebSocket-Schließcodes des Servers (WP-011/WP-012). Der Client verbindet sich nach 4000 und 4001 **nicht**
 * automatisch neu; nach allen anderen Codes (z. B. 1006 bei Netzabbruch, 1001 beim Herunterfahren) schon.
 */
/** Andere Protokollversion (`hello`) – Seite neu laden. */
export const CLOSE_UNSUPPORTED_VERSION = 4000;
/** Eine neuere Verbindung desselben Users hat `hello` gesendet und übernimmt (anderer Tab/Gerät). */
export const CLOSE_REPLACED = 4001;

// ---------------------------------------------------------------------------
// Tisch-Einstellungen
// ---------------------------------------------------------------------------

/** Vollständige Einstellungen eines Tisches (nach Anwendung der Defaults). Keine Antes (D-016). */
export interface TableSettings {
  /** 1–50 Zeichen (ohne Leerraum am Rand). */
  name: string;
  /** Öffentlich = in der Lobby sichtbar; privat = nur über den Einladungscode erreichbar. */
  isPublic: boolean;
  /** 2–9 Plätze (D-007); Sitze 0 … maxSeats − 1. */
  maxSeats: number;
  startingStack: number;
  blindStructure: BlindStructure;
  /** Sekunden pro Zug (D-013), 10–120 (D-020). */
  turnTimeSeconds: number;
  /** Zeitbank pro Spieler und Runde in Sekunden (D-013), 0–300 (D-020). */
  timeBankSeconds: number;
}

/** Eingabe beim Erstellen: nur `name` ist Pflicht, alles andere hat Defaults (`DEFAULT_TABLE_SETTINGS`). */
export type TableSettingsInput = { name: string } & Partial<Omit<TableSettings, 'name'>>;

/**
 * Status eines Tisches aus Client-Sicht: offen (Plätze wählbar) → läuft → beendet (Ergebnis steht, „Runde
 * beendet“). Aus `finished` kann der Ersteller mit `table.rematch` wieder nach `running` (D-020).
 */
export type TableStatus = 'open' | 'running' | 'finished';

export interface PublicUser {
  id: number;
  username: string;
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

interface ClientBase {
  /** Optional, frei wählbar (max. 64 Zeichen); kommt in `error` bzw. `table.created` zurück. */
  requestId?: string;
}

export interface HelloMessage extends ClientBase {
  type: 'hello';
  protocolVersion: number;
}
/**
 * Anwendungs-Heartbeat (WP-012): Browser sehen WebSocket-Pings nicht, also fragt der Client selbst nach.
 * Erlaubt auch vor `hello`. Antwort: `pong` mit derselben `requestId` und der Server-Uhr.
 */
export interface PingMessage extends ClientBase {
  type: 'ping';
}
export interface LobbySubscribeMessage extends ClientBase {
  type: 'lobby.subscribe';
}
export interface LobbyUnsubscribeMessage extends ClientBase {
  type: 'lobby.unsubscribe';
}
export interface TableCreateMessage extends ClientBase {
  type: 'table.create';
  settings: TableSettingsInput;
}
/** Tisch beobachten (Zuschauen). Öffentliche Tische per `tableId`, private nur per `inviteCode`. */
export type TableJoinMessage = ClientBase & { type: 'table.join' } & (
    { tableId: number; inviteCode?: never } | { inviteCode: string; tableId?: never }
  );
export interface TableLeaveMessage extends ClientBase {
  type: 'table.leave';
  tableId: number;
}
export interface TableSitMessage extends ClientBase {
  type: 'table.sit';
  tableId: number;
  seat: number;
}
export interface TableStandMessage extends ClientBase {
  type: 'table.stand';
  tableId: number;
}
export interface TableStartMessage extends ClientBase {
  type: 'table.start';
  tableId: number;
}
/**
 * „Nochmal“ (D-020, WP-015): Nur der Ersteller, nur im Status `finished`. Startet eine neue Runde am selben
 * Tisch mit denselben Sitzen (wer saß, spielt wieder mit – auch Getrennte) und frischen Stacks/Zeitbanken.
 */
export interface TableRematchMessage extends ClientBase {
  type: 'table.rematch';
  tableId: number;
}
/**
 * Aktion des Spielers am Zug. `handNumber` und `seq` stammen aus der zuletzt empfangenen `HandView`
 * (`handNumber`, `actionSeq`); passt eins nicht mehr, ist der Klick veraltet und wird abgelehnt.
 */
export interface TableActionMessage extends ClientBase {
  type: 'table.action';
  tableId: number;
  handNumber: number;
  seq: number;
  action: Action;
}
/**
 * Emoji-Reaktion (WP-032): nur Spieler mit Sitz an diesem Tisch, höchstens eine pro `REACTION_COOLDOWN_MS`
 * (sonst `RATE_LIMITED`). Der Server verteilt sie als `table.reaction` an alle Beobachter des Tisches.
 */
export interface TableReactMessage extends ClientBase {
  type: 'table.react';
  tableId: number;
  reaction: ReactionId;
}

export type ClientMessage =
  | HelloMessage
  | PingMessage
  | LobbySubscribeMessage
  | LobbyUnsubscribeMessage
  | TableCreateMessage
  | TableJoinMessage
  | TableLeaveMessage
  | TableSitMessage
  | TableStandMessage
  | TableStartMessage
  | TableRematchMessage
  | TableActionMessage
  | TableReactMessage;

export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------
// Gefilterte Sichten (pro Empfänger, D-003)
// ---------------------------------------------------------------------------

export interface HandPlayerView {
  playerId: string;
  seat: number;
  startStack: number;
  stack: number;
  status: PlayerStatus;
  streetBet: number;
  totalBet: number;
  hasActed: boolean;
  /** Eigene Karten immer; fremde nur, wenn sie im Showdown gezeigt wurden; sonst `null`. */
  holeCards: Card[] | null;
}

export interface ShowdownRevealView {
  playerId: string;
  /** Gezeigte Karten oder `null` (gemuckt). */
  shownCards: Card[] | null;
  /** Bewertung nur für gezeigte Hände (und die eigene), sonst `null`. */
  hand: ShowdownHand | null;
}

export interface ShowdownView {
  uncalled: Payout | null;
  pots: PotAward[];
  reveals: ShowdownRevealView[];
  allHandsShown: boolean;
}

/** Hand aus Sicht eines Empfängers – ohne Deck, verbrannte Karten und verdeckte fremde Karten. */
export interface HandView {
  handNumber: number;
  /** Laufende Nummer für `table.action.seq` (= Anzahl Protokolleinträge der Hand). */
  actionSeq: number;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  street: Street;
  phase: HandPhase;
  board: Card[];
  toActId: string | null;
  currentBet: number;
  minRaise: number;
  /** Summe aller Einsätze dieser Hand. */
  pot: number;
  players: HandPlayerView[];
  log: HandEvent[];
  payouts: Payout[] | null;
  showdown: ShowdownView | null;
  /** Nur für den Empfänger, wenn er am Zug ist; sonst `null`. */
  legalActions: LegalActions | null;
}

export interface BlindLevelView extends BlindLevel {
  levelIndex: number;
  /** Zeitpunkt (ms seit Epoche, Server-Uhr), ab dem das nächste Level gilt; `null` = keins. */
  nextLevelAtMs: number | null;
}

export interface RoundView {
  phase: RoundPhase;
  handNumber: number;
  /** Blind-Level einer jetzt startenden Hand (Anzeige „nächstes Level in …“). */
  blindLevel: BlindLevelView;
  /** Stacks zwischen den Händen, Platzierungen (öffentlich). */
  players: RoundPlayer[];
  hand: HandView | null;
  standings: RoundStanding[] | null;
}

export interface SeatView {
  seat: number;
  user: PublicUser;
  /** Gewählter Avatar (WP-032); `null` = keiner (Client zeigt den Anfangsbuchstaben). */
  avatar: AvatarId | null;
  /** Hat der Spieler gerade mindestens eine offene Verbindung zu diesem Tisch? */
  connected: boolean;
  /**
   * Verbleibende Zeitbank in ms zum Zeitpunkt `TableView.serverNowMs` (WP-012, pro Spieler und Runde).
   * Vor dem Start: `settings.timeBankSeconds × 1000`. Läuft gerade die Zeitbank dieses Spielers, ist das
   * der Stand bei `serverNowMs`; der Client rechnet selbst weiter (siehe `TurnClockView`).
   */
  timeBankMs: number;
}

/**
 * Zug-Uhr des Spielers am Zug (WP-012, D-013). Alle Zeitpunkte in ms seit Epoche nach **Server-Uhr**;
 * der Client gleicht seine Uhr über `TableView.serverNowMs` ab (Versatz = serverNowMs − lokale Zeit beim Empfang).
 * Phase 1 (normale Zugzeit): bis `turnEndsAtMs`. Phase 2 (Zeitbank): von `turnEndsAtMs` bis `deadlineMs`.
 * Ist `deadlineMs` ≤ `turnEndsAtMs`, gibt es keine Zeitbank-Phase (Zeitbank leer oder Spieler getrennt).
 * Bei `deadlineMs` handelt der Server automatisch: Check, wenn erlaubt, sonst Fold.
 */
export interface TurnClockView {
  playerId: string;
  seat: number;
  /** Gehört zu dieser Hand/Aktion (`HandView.handNumber`/`actionSeq`). */
  handNumber: number;
  actionSeq: number;
  /** Beginn des Zugs. */
  startedAtMs: number;
  /** Ende der normalen Zugzeit (`startedAtMs + turnTimeSeconds × 1000`). */
  turnEndsAtMs: number;
  /**
   * Zeitpunkt der automatischen Aktion: normalerweise `turnEndsAtMs` + Zeitbank zu Zugbeginn; ist der
   * Spieler getrennt, höchstens das Ende der kurzen Gnadenfrist (`DISCONNECT_GRACE_MS` auf dem Server).
   */
  deadlineMs: number;
}

export interface TableView {
  id: number;
  inviteCode: string;
  createdBy: PublicUser;
  settings: TableSettings;
  status: TableStatus;
  /** Nur besetzte Sitze, aufsteigend. Engine-`playerId` = `String(user.id)`. */
  seats: SeatView[];
  /** Anzahl Beobachter ohne Sitz. */
  spectators: number;
  round: RoundView | null;
  /** Zug-Uhr, solange in einer laufenden Hand jemand am Zug ist; sonst `null` (WP-012). */
  turnClock: TurnClockView | null;
  /** Server-Uhr beim Erstellen dieser Sicht (ms seit Epoche) – Bezug für alle Zeitpunkte (WP-012). */
  serverNowMs: number;
  /** Wer diese Sicht bekommt. */
  you: { userId: number; seat: number | null; isCreator: boolean };
}

export interface LobbyTable {
  id: number;
  name: string;
  createdBy: PublicUser;
  status: 'open' | 'running';
  seated: number;
  maxSeats: number;
  startingStack: number;
  /** Blinds des ersten Levels (bzw. die festen Blinds). */
  blinds: BlindLevel;
  blindType: BlindStructure['type'];
  turnTimeSeconds: number;
  timeBankSeconds: number;
}

export interface StandingView extends RoundStanding {
  user: PublicUser;
}

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'BAD_MESSAGE'
  | 'UNSUPPORTED_VERSION'
  | 'HELLO_REQUIRED'
  | 'INVALID_SETTINGS'
  | 'TABLE_NOT_FOUND'
  | 'NOT_AT_TABLE'
  | 'INVALID_SEAT'
  | 'SEAT_TAKEN'
  | 'TABLE_FULL'
  | 'ALREADY_SEATED'
  | 'NOT_SEATED'
  | 'ROUND_STARTED'
  | 'NOT_CREATOR'
  | 'NOT_ENOUGH_PLAYERS'
  | 'ROUND_NOT_FINISHED'
  | 'NO_HAND_IN_PROGRESS'
  | 'STALE_ACTION'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'ILLEGAL_ACTION'
  | 'AMOUNT_TOO_SMALL'
  | 'AMOUNT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export interface WelcomeMessage {
  type: 'welcome';
  protocolVersion: number;
  user: PublicUser;
}
/** Fehler geht nur an den Absender; der Tisch läuft weiter. */
export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
  requestId: string | null;
  tableId: number | null;
}
/** Antwort auf `ping` (WP-012). */
export interface PongMessage {
  type: 'pong';
  requestId: string | null;
  /** Server-Uhr (ms seit Epoche), z. B. zum Abgleich der Client-Uhr. */
  serverNowMs: number;
}
export interface LobbySnapshotMessage {
  type: 'lobby.snapshot';
  tables: LobbyTable[];
}
export interface LobbyUpdateMessage {
  type: 'lobby.update';
  table: LobbyTable;
}
export interface LobbyRemoveMessage {
  type: 'lobby.remove';
  tableId: number;
}
export interface TableCreatedMessage {
  type: 'table.created';
  requestId: string | null;
  tableId: number;
  inviteCode: string;
}
/** Vollständige, für den Empfänger gefilterte Sicht – nach jeder Änderung neu. */
export interface TableStateMessage {
  type: 'table.state';
  table: TableView;
}
export interface TableLeftMessage {
  type: 'table.left';
  tableId: number;
}
export interface RoundFinishedMessage {
  type: 'table.roundFinished';
  tableId: number;
  standings: StandingView[];
}

/**
 * Der Tisch existiert nicht mehr (WP-015): `abandoned` = verwaiste Runde, 10 Minuten lang kein Spieler
 * verbunden → Runde ohne Punkte abgebrochen (D-022). Geht an alle, die den Tisch noch beobachten; danach
 * liefert `table.join` für diesen Tisch `TABLE_NOT_FOUND`.
 */
export interface TableClosedMessage {
  type: 'table.closed';
  tableId: number;
  reason: 'abandoned';
}

/**
 * Emoji-Reaktion eines Spielers (WP-032) an alle Beobachter des Tisches (auch den Absender). Flüchtig: wird
 * nicht gespeichert und nach einem Reconnect nicht wiederholt.
 */
export interface TableReactionMessage {
  type: 'table.reaction';
  tableId: number;
  seat: number;
  userId: number;
  reaction: ReactionId;
}

export type ServerMessage =
  | WelcomeMessage
  | ErrorMessage
  | PongMessage
  | LobbySnapshotMessage
  | LobbyUpdateMessage
  | LobbyRemoveMessage
  | TableCreatedMessage
  | TableStateMessage
  | TableLeftMessage
  | RoundFinishedMessage
  | TableClosedMessage
  | TableReactionMessage;

export type ServerMessageType = ServerMessage['type'];
