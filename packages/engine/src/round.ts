/**
 * Freezeout-Runde (WP-008, D-012) als reine, JSON-serialisierbare Zustandsmaschine über vielen Händen:
 * `startRound` → (`startNextHand` → `applyRoundAction`*)* → Phase `finished` mit Platzierungen und Punkten.
 * Zeit kommt nur als Parameter (`nowMs`), Zufall als injiziertes `Rng`. Eingabezustände werden nie verändert.
 * Beschreibung: ARCHITECTURE.md, „Engine: Rundenmodell (Freezeout)“.
 */
import { applyAction, startHand } from './betting';
import {
  blindLevelEndsAfterMs,
  blindLevelIndexAt,
  blindLevels,
  type BlindLevel,
  type BlindStructure,
} from './blind-structure';
import { firstHandPositions, nextHandPositions, type HandPositions } from './button';
import type { Action, HandErrorCode, HandState } from './hand-state';
import { placementPoints } from './points';
import type { Rng } from './rng';

export interface RoundConfig {
  /** Startstack jedes Spielers (ganze Zahl, 1 … 10⁸, D-015). */
  startingStack: number;
  blindStructure: BlindStructure;
  /** Zeit pro Zug in Sekunden – nur durchgereicht, den Timer führt der Server (D-013). */
  turnTimeSeconds: number;
  /** Zeitbank pro Spieler und Runde in Sekunden – nur durchgereicht (D-013). */
  timeBankSeconds: number;
}

/** Standardwerte für Zeitlimit und Zeitbank (D-013). */
export const DEFAULT_TURN_TIME_SECONDS = 20;
export const DEFAULT_TIME_BANK_SECONDS = 60;

export interface RoundSeat {
  id: string;
  /** Sitz 0–8 (D-007). */
  seat: number;
}

export interface RoundPlayer {
  id: string;
  seat: number;
  /** Chips zwischen den Händen (während einer Hand: Stand vor dieser Hand). 0 = ausgeschieden. */
  stack: number;
  /** Platzierung (1 = Sieger), sobald feststehend; sonst `null`. */
  placement: number | null;
  /** Platz wird mit anderen geteilt (gleichzeitig ausgeschieden mit gleichem Stack zu Handbeginn). */
  sharedPlacement: boolean;
  /** Nummer der Hand, in der der Spieler ausgeschieden ist; sonst `null`. */
  eliminatedInHand: number | null;
}

/** Endergebnis eines Spielers. */
export interface RoundStanding {
  playerId: string;
  seat: number;
  placement: number;
  sharedPlacement: boolean;
  points: number;
}

/**
 * - `waiting`: vor der ersten bzw. zwischen zwei Händen (`hand` = zuletzt beendete Hand oder `null`).
 * - `hand`: eine Hand läuft (`hand.phase === 'betting'`).
 * - `finished`: ein Spieler hat alle Chips, `standings` ist gesetzt.
 */
export type RoundPhase = 'waiting' | 'hand' | 'finished';

export interface RoundState {
  config: RoundConfig;
  /** Spieler zu Rundenbeginn, nach Sitz sortiert (ausgeschiedene bleiben mit Stack 0 stehen). */
  players: RoundPlayer[];
  phase: RoundPhase;
  /** Zeitpunkt der ersten Hand (ms, vom Server übergeben); Grundlage für Blind-Level. */
  startedAtMs: number | null;
  /** Anzahl gestarteter Hände (= Nummer der aktuellen bzw. letzten Hand, ab 1). */
  handNumber: number;
  /** Level-Index der aktuellen bzw. letzten Hand. */
  levelIndex: number;
  /** Button der ersten Hand (vor der ersten Hand festgelegt). */
  firstButtonSeat: number;
  /** Positionen der aktuellen bzw. letzten Hand; `null` vor der ersten Hand. */
  positions: HandPositions | null;
  /** Aktuelle bzw. zuletzt beendete Hand. */
  hand: HandState | null;
  /** Endergebnis nach Platzierung (bei geteilten Plätzen nach Sitz), nur in Phase `finished`. */
  standings: RoundStanding[] | null;
}

export type RoundErrorCode =
  | HandErrorCode
  | 'INVALID_CONFIG'
  | 'INVALID_PLAYERS'
  | 'INVALID_TIME'
  | 'HAND_IN_PROGRESS'
  | 'NO_HAND_IN_PROGRESS'
  | 'ROUND_FINISHED';

export interface RoundError {
  code: RoundErrorCode;
  message: string;
}

export type RoundUpdate = { ok: true; round: RoundState } | { ok: false; error: RoundError };

export interface StartRoundOptions {
  /** Button der ersten Hand (besetzter Sitz). Ohne Angabe zufällig per `rng`. */
  buttonSeat?: number;
}

/** Aktuelles Blind-Level aus Sicht des Servers (z. B. für die Anzeige „nächstes Level in …“). */
export interface RoundBlindLevel extends BlindLevel {
  levelIndex: number;
  /** Zeitpunkt (ms), ab dem das nächste Level gilt – wirksam ab der ersten danach gestarteten Hand; `null` = keins. */
  nextLevelAtMs: number | null;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 9; // D-007
const MAX_SEAT = 8; // Sitze 0–8 (D-007)
const MAX_STARTING_STACK = 100_000_000; // D-015
const MAX_BLIND_LEVELS = 100;

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/** Prüft eine Rundenkonfiguration; `null` = gültig, sonst deutscher Klartext. */
export function validateRoundConfig(config: RoundConfig): string | null {
  if (typeof config !== 'object' || (config as unknown) === null) return 'Konfiguration muss ein Objekt sein';
  const { startingStack, blindStructure, turnTimeSeconds, timeBankSeconds } = config;
  if (!isPositiveInt(startingStack) || startingStack > MAX_STARTING_STACK) {
    return `startingStack muss eine ganze Zahl von 1 bis ${String(MAX_STARTING_STACK)} sein`;
  }
  if (!isPositiveInt(turnTimeSeconds)) return 'turnTimeSeconds muss eine positive ganze Zahl sein';
  if (!isNonNegativeInt(timeBankSeconds)) return 'timeBankSeconds muss eine nicht-negative ganze Zahl sein';
  if (typeof blindStructure !== 'object' || (blindStructure as unknown) === null) {
    return 'blindStructure muss ein Objekt sein';
  }
  if ('ante' in blindStructure || 'ante' in config) return 'Antes gibt es nicht (D-016)';
  let levels: readonly BlindLevel[];
  switch (blindStructure.type) {
    case 'fixed':
      levels = [blindStructure.level];
      break;
    case 'increasing':
      if (!isPositiveInt(blindStructure.levelMinutes)) return 'levelMinutes muss eine positive ganze Zahl sein';
      if (!Array.isArray(blindStructure.levels) || blindStructure.levels.length === 0) {
        return 'levels muss mindestens ein Level enthalten';
      }
      if (blindStructure.levels.length > MAX_BLIND_LEVELS) {
        return `höchstens ${String(MAX_BLIND_LEVELS)} Level erlaubt`;
      }
      levels = blindStructure.levels;
      break;
    default:
      return `Unbekannte Blind-Struktur ${JSON.stringify((blindStructure as { type?: unknown }).type)} (erlaubt: fixed, increasing)`;
  }
  for (const [i, level] of levels.entries()) {
    const label = `Level ${String(i + 1)}`;
    if (typeof level !== 'object' || (level as unknown) === null) return `${label} muss ein Objekt sein`;
    if ('ante' in level) return `${label}: Antes gibt es nicht (D-016)`;
    if (!isPositiveInt(level.smallBlind) || level.smallBlind > MAX_STARTING_STACK) {
      return `${label}: smallBlind muss eine positive ganze Zahl sein`;
    }
    if (!isPositiveInt(level.bigBlind) || level.bigBlind > MAX_STARTING_STACK) {
      return `${label}: bigBlind muss eine positive ganze Zahl sein`;
    }
    if (level.smallBlind >= level.bigBlind) return `${label}: smallBlind muss kleiner als bigBlind sein`;
  }
  return null;
}

/**
 * Legt eine Runde an (noch ohne Hand). Alle Spieler bekommen den Startstack. Der Button der ersten Hand
 * ist `options.buttonSeat` oder ein zufälliger besetzter Sitz (per `rng`).
 */
export function startRound(
  config: RoundConfig,
  players: readonly RoundSeat[],
  rng: Rng,
  options: StartRoundOptions = {},
): RoundUpdate {
  const configError = validateRoundConfig(config);
  if (configError !== null) return fail('INVALID_CONFIG', configError);
  const playersError = validatePlayers(players);
  if (playersError !== null) return fail('INVALID_PLAYERS', playersError);

  const sorted = [...players].sort((a, b) => a.seat - b.seat);
  let firstButtonSeat: number;
  if (options.buttonSeat !== undefined) {
    if (!sorted.some((p) => p.seat === options.buttonSeat)) {
      return fail('INVALID_PLAYERS', `buttonSeat ${String(options.buttonSeat)} ist nicht besetzt`);
    }
    firstButtonSeat = options.buttonSeat;
  } else {
    firstButtonSeat = (sorted[rng.int(sorted.length)] as RoundSeat).seat;
  }

  const round: RoundState = {
    config: copyConfig(config),
    players: sorted.map((p) => ({
      id: p.id,
      seat: p.seat,
      stack: config.startingStack,
      placement: null,
      sharedPlacement: false,
      eliminatedInHand: null,
    })),
    phase: 'waiting',
    startedAtMs: null,
    handNumber: 0,
    levelIndex: 0,
    firstButtonSeat,
    positions: null,
    hand: null,
    standings: null,
  };
  return { ok: true, round };
}

/**
 * Startet die nächste Hand mit den Blinds des Levels zum Zeitpunkt `nowMs` (die erste Hand legt
 * `startedAtMs` fest). Ein Level-Wechsel wirkt damit nur ab Handbeginn, nie mitten in einer Hand.
 * Endet die Hand sofort (alle All-in durch die Blinds), ist sie im Ergebnis schon abgerechnet.
 */
export function startNextHand(round: RoundState, nowMs: number, rng: Rng): RoundUpdate {
  if (round.phase === 'finished') return fail('ROUND_FINISHED', 'Die Runde ist beendet');
  if (round.phase === 'hand') return fail('HAND_IN_PROGRESS', 'Es läuft noch eine Hand');
  if (!isNonNegativeInt(nowMs)) return fail('INVALID_TIME', 'nowMs muss eine nicht-negative ganze Zahl sein');

  const next = cloneRound(round);
  next.startedAtMs ??= nowMs;
  // Level nie zurückdrehen, auch wenn die übergebene Zeit (z. B. nach Uhrumstellung) kleiner ist.
  next.levelIndex = Math.max(round.levelIndex, blindLevelIndexAt(next.config.blindStructure, nowMs - next.startedAtMs));
  const level = blindLevels(next.config.blindStructure)[next.levelIndex] as BlindLevel;

  const alive = next.players.filter((p) => p.stack > 0);
  const aliveSeats = alive.map((p) => p.seat);
  const positions =
    next.positions === null
      ? firstHandPositions(aliveSeats, next.firstButtonSeat)
      : nextHandPositions(next.positions, aliveSeats);

  const started = startHand({
    players: alive.map((p) => ({ id: p.id, seat: p.seat, stack: p.stack })),
    buttonSeat: positions.buttonSeat,
    smallBlind: level.smallBlind,
    bigBlind: level.bigBlind,
    blinds: { smallBlindSeat: positions.smallBlindSeat, bigBlindSeat: positions.bigBlindSeat },
    rng,
  });
  if (!started.ok) return { ok: false, error: started.error };

  next.handNumber += 1;
  next.positions = positions;
  next.hand = started.state;
  next.phase = 'hand';
  settleIfComplete(next);
  return { ok: true, round: next };
}

/**
 * Reicht eine Aktion an die laufende Hand weiter (Fehler der Hand kommen unverändert zurück).
 * Ist die Hand danach beendet, werden Stacks übernommen, Ausgeschiedene platziert und ggf. die Runde beendet.
 */
export function applyRoundAction(round: RoundState, playerId: string, action: Action): RoundUpdate {
  if (round.phase === 'finished') return fail('ROUND_FINISHED', 'Die Runde ist beendet');
  if (round.phase !== 'hand' || round.hand === null) {
    return fail('NO_HAND_IN_PROGRESS', 'Keine laufende Hand – erst startNextHand aufrufen');
  }
  const result = applyAction(round.hand, playerId, action);
  if (!result.ok) return { ok: false, error: result.error };
  const next = cloneRound(round);
  next.hand = result.state;
  settleIfComplete(next);
  return { ok: true, round: next };
}

/**
 * Blind-Level zum Zeitpunkt `nowMs`, also das Level, mit dem eine jetzt gestartete Hand gespielt würde.
 * Vor der ersten Hand: Level 1 ohne Zeitpunkt für das nächste Level.
 */
export function roundBlindLevel(round: RoundState, nowMs: number): RoundBlindLevel {
  const structure = round.config.blindStructure;
  const levels = blindLevels(structure);
  if (round.startedAtMs === null) {
    return { ...(levels[0] as BlindLevel), levelIndex: 0, nextLevelAtMs: null };
  }
  const levelIndex = Math.max(round.levelIndex, blindLevelIndexAt(structure, nowMs - round.startedAtMs));
  const endsAfter = blindLevelEndsAfterMs(structure, levelIndex);
  return {
    ...(levels[levelIndex] as BlindLevel),
    levelIndex,
    nextLevelAtMs: endsAfter === null ? null : round.startedAtMs + endsAfter,
  };
}

// ---------------------------------------------------------------------------
// Abrechnung nach einer Hand
// ---------------------------------------------------------------------------

/** Nach einer beendeten Hand: Stacks übernehmen, Ausgeschiedene platzieren, Rundenende prüfen. */
function settleIfComplete(round: RoundState): void {
  const hand = round.hand;
  if (hand === null || hand.phase !== 'complete') return;

  for (const hp of hand.players) {
    const rp = round.players.find((p) => p.id === hp.id);
    if (rp === undefined) throw new Error(`Interner Fehler: Spieler ${hp.id} fehlt in der Runde`);
    rp.stack = hp.stack;
  }

  // Ausgeschiedene dieser Hand: nach Stack zu Handbeginn absteigend; gleicher Stack → geteilter Platz (TDA).
  const busted = hand.players.filter((p) => p.stack === 0).sort((a, b) => b.startStack - a.startStack);
  const remaining = round.players.filter((p) => p.stack > 0).length;
  let place = remaining + 1;
  for (let i = 0; i < busted.length;) {
    const startStack = (busted[i] as HandState['players'][number]).startStack;
    let j = i;
    while (j < busted.length && (busted[j] as HandState['players'][number]).startStack === startStack) j++;
    for (const hp of busted.slice(i, j)) {
      const rp = round.players.find((p) => p.id === hp.id) as RoundPlayer;
      rp.placement = place;
      rp.sharedPlacement = j - i > 1;
      rp.eliminatedInHand = round.handNumber;
    }
    place += j - i;
    i = j;
  }

  if (remaining > 1) {
    round.phase = 'waiting';
    return;
  }
  const winner = round.players.find((p) => p.stack > 0);
  if (winner === undefined) throw new Error('Interner Fehler: niemand hat noch Chips');
  winner.placement = 1;
  round.phase = 'finished';
  round.standings = computeStandings(round.players);
}

function computeStandings(players: readonly RoundPlayer[]): RoundStanding[] {
  const n = players.length;
  const tied = new Map<number, number>();
  for (const p of players) tied.set(p.placement as number, (tied.get(p.placement as number) ?? 0) + 1);
  return [...players]
    .sort((a, b) => (a.placement as number) - (b.placement as number) || a.seat - b.seat)
    .map((p) => {
      const placement = p.placement as number;
      return {
        playerId: p.id,
        seat: p.seat,
        placement,
        sharedPlacement: p.sharedPlacement,
        points: placementPoints(placement, n, tied.get(placement)),
      };
    });
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const isNonNegativeInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function validatePlayers(players: readonly RoundSeat[]): string | null {
  const list: unknown = players;
  if (!Array.isArray(list)) return 'players muss eine Liste sein';
  const n = players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    return `${String(MIN_PLAYERS)}–${String(MAX_PLAYERS)} Spieler nötig, waren ${String(n)}`;
  }
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const p of players) {
    if (typeof p.id !== 'string' || p.id === '') return 'Spieler-ID muss ein nicht-leerer String sein';
    if (ids.has(p.id)) return `Spieler-ID doppelt: ${p.id}`;
    ids.add(p.id);
    if (!isNonNegativeInt(p.seat) || p.seat > MAX_SEAT) {
      return `Sitz von ${p.id} muss eine ganze Zahl von 0 bis ${String(MAX_SEAT)} sein`;
    }
    if (seats.has(p.seat)) return `Sitz doppelt: ${String(p.seat)}`;
    seats.add(p.seat);
  }
  return null;
}

function copyConfig(config: RoundConfig): RoundConfig {
  const s = config.blindStructure;
  return {
    startingStack: config.startingStack,
    blindStructure:
      s.type === 'fixed'
        ? { type: 'fixed', level: { smallBlind: s.level.smallBlind, bigBlind: s.level.bigBlind } }
        : {
            type: 'increasing',
            levels: s.levels.map((l) => ({ smallBlind: l.smallBlind, bigBlind: l.bigBlind })),
            levelMinutes: s.levelMinutes,
          },
    turnTimeSeconds: config.turnTimeSeconds,
    timeBankSeconds: config.timeBankSeconds,
  };
}

/** Flache Kopie: `config` und `hand` werden nie verändert, sondern nur ersetzt. */
function cloneRound(round: RoundState): RoundState {
  return {
    ...round,
    players: round.players.map((p) => ({ ...p })),
    positions: round.positions === null ? null : { ...round.positions },
    standings: round.standings === null ? null : round.standings.map((s) => ({ ...s })),
  };
}

function fail(code: RoundErrorCode, message: string): { ok: false; error: RoundError } {
  return { ok: false, error: { code, message } };
}
