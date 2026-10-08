-- WP-009: Grundschema für Accounts, Tische, Runden und Hand-Historie.
-- Übersicht und Begründungen: docs/ARCHITECTURE.md, Abschnitt „Datenmodell“.
-- Läuft in einer Transaktion (Migrations-Runner); keine Schema-Präfixe, damit Tests ein eigenes Schema nutzen können.
--
-- Konventionen:
-- - IDs, Chips und Punkte sind `integer` (pg liefert sie als JS-number; Größenordnung siehe ARCHITECTURE.md).
-- - Verweise auf `users` sind ON DELETE RESTRICT: Accounts werden nie hart gelöscht, sondern anonymisiert
--   (WP-022), damit die Hand-Historie der anderen Spieler vollständig bleibt.
-- - Kindtabellen eines Aggregats (Runde → Teilnehmer/Hände, Hand → Aktionen) kaskadieren.

CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL nur nach Anonymisierung (deleted_at gesetzt).
  username      text,
  password_hash text,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT users_username_length CHECK (char_length(username) BETWEEN 3 AND 20),
  CONSTRAINT users_active_has_credentials CHECK (
    deleted_at IS NOT NULL OR (username IS NOT NULL AND password_hash IS NOT NULL)
  )
);

-- Benutzernamen sind case-insensitive eindeutig (D-011).
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

CREATE TABLE sessions (
  -- SHA-256 des Session-Tokens; das Token selbst wird nie gespeichert.
  token_hash bytea PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE tables (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_by         integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  name               text NOT NULL,
  is_public          boolean NOT NULL,
  -- Code für den Einladungslink; jeder Tisch hat einen, private Tische sind nur darüber erreichbar.
  invite_code        text NOT NULL,
  max_seats          smallint NOT NULL DEFAULT 9,
  starting_stack     integer NOT NULL,
  small_blind        integer NOT NULL,
  big_blind          integer NOT NULL,
  -- Blind-Erhöhung (D-012), Form legt WP-008/WP-011 fest, z. B. {"type":"increasing","intervalMinutes":10,...}.
  blind_structure    jsonb NOT NULL,
  -- D-013: Standard 20 s pro Zug, 60 s Zeitbank pro Spieler und Runde.
  turn_time_seconds  integer NOT NULL DEFAULT 20,
  time_bank_seconds  integer NOT NULL DEFAULT 60,
  status             text NOT NULL DEFAULT 'open',
  created_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  CONSTRAINT tables_invite_code_key UNIQUE (invite_code),
  CONSTRAINT tables_name_length CHECK (char_length(name) BETWEEN 1 AND 50),
  CONSTRAINT tables_max_seats CHECK (max_seats BETWEEN 2 AND 9),
  -- Obergrenze, damit die Summe aller Stacks (max. 9 Spieler) sicher in integer passt.
  CONSTRAINT tables_starting_stack CHECK (starting_stack > 0 AND starting_stack <= 100000000),
  CONSTRAINT tables_blinds CHECK (small_blind > 0 AND big_blind >= small_blind AND big_blind <= starting_stack),
  CONSTRAINT tables_blind_structure_object CHECK (jsonb_typeof(blind_structure) = 'object'),
  CONSTRAINT tables_turn_time CHECK (turn_time_seconds > 0),
  CONSTRAINT tables_time_bank CHECK (time_bank_seconds >= 0),
  CONSTRAINT tables_status CHECK (status IN ('open', 'running', 'closed')),
  CONSTRAINT tables_closed_at CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE INDEX tables_created_by_idx ON tables (created_by);
-- Lobby: öffentliche, nicht geschlossene Tische.
CREATE INDEX tables_lobby_idx ON tables (created_at) WHERE is_public AND status <> 'closed';

CREATE TABLE rounds (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_id    integer NOT NULL REFERENCES tables (id) ON DELETE RESTRICT,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- aborted: z. B. Server-Neustart während der Runde (WP-013), dann ohne Punkte.
  status      text NOT NULL DEFAULT 'running',
  CONSTRAINT rounds_status CHECK (status IN ('running', 'finished', 'aborted')),
  CONSTRAINT rounds_finished_at CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT rounds_finished_after_start CHECK (finished_at >= started_at)
);

CREATE INDEX rounds_table_id_idx ON rounds (table_id, started_at);

CREATE TABLE round_players (
  round_id  integer NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  user_id   integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- Sitzindex 0–8 (D-007).
  seat      smallint NOT NULL,
  -- 1 = Sieger; NULL solange die Runde läuft oder wenn sie abgebrochen wurde.
  placement smallint,
  -- Punkte nach D-012 (Formel in der Engine); NULL wie placement.
  points    integer,
  PRIMARY KEY (round_id, user_id),
  CONSTRAINT round_players_seat_key UNIQUE (round_id, seat),
  CONSTRAINT round_players_placement_key UNIQUE (round_id, placement),
  CONSTRAINT round_players_seat CHECK (seat BETWEEN 0 AND 8),
  CONSTRAINT round_players_placement CHECK (placement BETWEEN 1 AND 9),
  CONSTRAINT round_players_points CHECK (points >= 0)
);

-- Rangliste (SUM(points) GROUP BY user_id, Index-Only-Scan) und „letzte Runden eines Users“.
CREATE INDEX round_players_user_points_idx ON round_players (user_id, points);
CREATE INDEX round_players_user_round_idx ON round_players (user_id, round_id);

CREATE TABLE hands (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id    integer NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  hand_number integer NOT NULL,
  button_seat smallint NOT NULL,
  small_blind integer NOT NULL,
  big_blind   integer NOT NULL,
  -- Gemeinschaftskarten als Karten-Strings der Engine ("As", "Td"), 0–5 Stück.
  board       text[] NOT NULL DEFAULT '{}',
  -- Spieler zu Handbeginn (Sitz, user_id, Stack, Hole Cards) für Replay und Statistik (WP-013).
  players     jsonb NOT NULL DEFAULT '[]',
  -- Pots, Gewinner, gezeigte Karten; NULL solange die Hand läuft.
  result      jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT hands_round_hand_number_key UNIQUE (round_id, hand_number),
  CONSTRAINT hands_hand_number CHECK (hand_number >= 1),
  CONSTRAINT hands_button_seat CHECK (button_seat BETWEEN 0 AND 8),
  CONSTRAINT hands_blinds CHECK (small_blind > 0 AND big_blind >= small_blind),
  CONSTRAINT hands_board CHECK (cardinality(board) <= 5),
  CONSTRAINT hands_players_array CHECK (jsonb_typeof(players) = 'array'),
  CONSTRAINT hands_finished_after_start CHECK (finished_at >= started_at)
);

CREATE TABLE hand_actions (
  hand_id    integer NOT NULL REFERENCES hands (id) ON DELETE CASCADE,
  -- Reihenfolge innerhalb der Hand, ab 1.
  seq        integer NOT NULL,
  user_id    integer NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  street     text NOT NULL,
  action     text NOT NULL,
  -- Gesetzter Betrag dieser Aktion (0 bei fold/check).
  amount     integer NOT NULL DEFAULT 0,
  is_all_in  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hand_id, seq),
  CONSTRAINT hand_actions_seq CHECK (seq >= 1),
  CONSTRAINT hand_actions_street CHECK (street IN ('preflop', 'flop', 'turn', 'river')),
  CONSTRAINT hand_actions_action CHECK (
    action IN ('small_blind', 'big_blind', 'fold', 'check', 'call', 'bet', 'raise')
  ),
  CONSTRAINT hand_actions_amount CHECK (amount >= 0)
);

-- Hand-Historie und Statistiken (VPIP, PFR …) pro User.
CREATE INDEX hand_actions_user_hand_idx ON hand_actions (user_id, hand_id);
