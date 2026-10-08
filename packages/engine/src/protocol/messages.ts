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

/** Version des Protokolls; der Client nennt sie in `hello`, bei Abweichung lehnt der Server ab. */
export const PROTOCOL_VERSION = 1;

/** Größte erlaubte Nachricht (Bytes); größere Frames trennt der Server (`ws` maxPayload). */
export const MAX_MESSAGE_BYTES = 64 * 1024;

/** Höchstlänge einer frei wählbaren `requestId` (wird in Antworten und Fehlern zurückgegeben). */
export const MAX_REQUEST_ID_LENGTH = 64;

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
  /** Sekunden pro Zug (D-013). */
  turnTimeSeconds: number;
  /** Zeitbank pro Spieler und Runde in Sekunden (D-013). */
  timeBankSeconds: number;
}

/** Eingabe beim Erstellen: nur `name` ist Pflicht, alles andere hat Defaults (`DEFAULT_TABLE_SETTINGS`). */
export type TableSettingsInput = { name: string } & Partial<Omit<TableSettings, 'name'>>;

/** Status eines Tisches aus Client-Sicht: offen (Plätze wählbar) → läuft → beendet (Ergebnis steht). */
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

export type ClientMessage =
  | HelloMessage
  | LobbySubscribeMessage
  | LobbyUnsubscribeMessage
  | TableCreateMessage
  | TableJoinMessage
  | TableLeaveMessage
  | TableSitMessage
  | TableStandMessage
  | TableStartMessage
  | TableActionMessage;

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
  /** Hat der Spieler gerade mindestens eine offene Verbindung zu diesem Tisch? */
  connected: boolean;
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
  | 'NO_HAND_IN_PROGRESS'
  | 'STALE_ACTION'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'ILLEGAL_ACTION'
  | 'AMOUNT_TOO_SMALL'
  | 'AMOUNT_TOO_LARGE'
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

export type ServerMessage =
  | WelcomeMessage
  | ErrorMessage
  | LobbySnapshotMessage
  | LobbyUpdateMessage
  | LobbyRemoveMessage
  | TableCreatedMessage
  | TableStateMessage
  | TableLeftMessage
  | RoundFinishedMessage;

export type ServerMessageType = ServerMessage['type'];
