// Handgeschriebene Zeilentypen für Query-Ergebnisse, Spalten 1:1 wie in migrations/*.sql (snake_case).
// Abbildung durch `pg`: integer/smallint → number, timestamptz → Date, jsonb → geparstes JSON,
// text[] → string[], bytea → Buffer. Ändert eine Migration eine Tabelle, wird der Typ hier im selben Commit angepasst.

export type TableStatus = 'open' | 'running' | 'closed';
export type RoundStatus = 'running' | 'finished' | 'aborted';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandActionType = 'small_blind' | 'big_blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

/** Beliebiger JSON-Wert, wie `pg` ihn für jsonb-Spalten liefert. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface UserRow {
  id: number;
  /** `null` nur bei anonymisierten Accounts (`deleted_at` gesetzt). */
  username: string | null;
  password_hash: string | null;
  is_admin: boolean;
  created_at: Date;
  deleted_at: Date | null;
  /** Avatar-ID aus `AVATAR_IDS` (WP-032, Migration 0008); `null` = keiner bzw. gelöschter Account. */
  avatar: string | null;
}

export interface SessionRow {
  /** SHA-256 des Session-Tokens (32 Byte). */
  token_hash: Buffer;
  user_id: number;
  created_at: Date;
  expires_at: Date;
}

export interface TableRow {
  id: number;
  created_by: number;
  name: string;
  is_public: boolean;
  invite_code: string;
  max_seats: number;
  starting_stack: number;
  small_blind: number;
  big_blind: number;
  blind_structure: { [key: string]: Json };
  turn_time_seconds: number;
  time_bank_seconds: number;
  status: TableStatus;
  created_at: Date;
  closed_at: Date | null;
}

export interface RoundRow {
  id: number;
  table_id: number;
  started_at: Date;
  finished_at: Date | null;
  status: RoundStatus;
}

export interface RoundPlayerRow {
  round_id: number;
  user_id: number;
  /** Sitzindex 0–8. */
  seat: number;
  /** 1 = Sieger; `null` solange die Runde läuft oder bei Abbruch. */
  placement: number | null;
  points: number | null;
}

export interface HandRow {
  id: number;
  round_id: number;
  hand_number: number;
  button_seat: number;
  small_blind: number;
  big_blind: number;
  /** Karten-Strings der Engine, z. B. `["As", "Td", "2c"]`. */
  board: string[];
  /** Form: `StoredHandPlayer[]` (`history/records.ts`). */
  players: Json[];
  /** Form: `StoredHandResult` (`history/records.ts`); `null` solange die Hand läuft. */
  result: Json | null;
  started_at: Date;
  finished_at: Date | null;
  /** 0003: Sitz des Small Blinds; `null` = kein Small Blind (oder Altzeile vor WP-013). */
  small_blind_seat: number | null;
  /** 0003: Sitz des Big Blinds; `null` nur bei Altzeilen vor WP-013. */
  big_blind_seat: number | null;
  /** 0003: Deck zu Handbeginn (52 Karten, erstes = oberste); nur serverseitig (D-003). */
  deck: string[] | null;
}

export interface HandActionRow {
  hand_id: number;
  seq: number;
  user_id: number;
  street: Street;
  action: HandActionType;
  amount: number;
  is_all_in: boolean;
  /** 0003: vom Server automatisch ausgeführt (Zeitablauf/Trennung, D-013). */
  is_automatic: boolean;
  created_at: Date;
}

export interface SchemaMigrationRow {
  version: string;
  checksum: string;
  applied_at: Date;
}

/** 0004 (WP-024): Feedback der Spieler. */
export interface FeedbackRow {
  id: number;
  /** `null` = Account gelöscht/anonymisiert. */
  user_id: number | null;
  category: 'bug' | 'idea' | 'other';
  /** 1–2000 Zeichen. */
  message: string;
  /** Pfad der Seite, z. B. `/table/42`. */
  page: string | null;
  /** Tisch laut Client, ohne Fremdschlüssel. */
  table_id: number | null;
  app_version: string | null;
  /** Wird bei Account-Löschung geleert. */
  user_agent: string | null;
  orientation: 'auto' | 'portrait' | 'landscape' | null;
  status: 'new' | 'read' | 'done';
  created_at: Date;
  /** 0006 (WP-022): Zeitpunkt des Erledigens, nur bei `status = 'done'` gesetzt (Löschfrist, D-025). */
  done_at: Date | null;
}
