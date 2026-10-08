// WebSocket-Protokoll (WP-011), Subpfad `@poker/engine/protocol`: Nachrichtentypen, Validatoren und
// gefilterte Sichten. Rein und browser-tauglich – Server und Web-Client nutzen dasselbe Modul.
export * from './messages';
export {
  DEFAULT_STARTING_STACK,
  DEFAULT_TABLE_SETTINGS,
  MAX_SEATS,
  MAX_TIME_BANK_SECONDS,
  MAX_TURN_TIME_SECONDS,
  MIN_SEATS,
  TABLE_NAME_MAX_LENGTH,
  parseClientMessage,
  validateTableSettings,
} from './validate';
export type { ClientMessageParseResult, Validated } from './validate';
export { toClientView, toHandView } from './view';
