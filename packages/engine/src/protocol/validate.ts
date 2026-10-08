/**
 * Handgeschriebene Validatoren für eingehende Client-Nachrichten (WP-011). Jede Nachricht wird vollständig
 * geprüft und in ein frisches Objekt mit nur den bekannten Feldern kopiert (unbekannte Felder fallen weg).
 */
import { DEFAULT_BLIND_STRUCTURE, type BlindLevel, type BlindStructure } from '../blind-structure';
import type { Action } from '../hand-state';
import { DEFAULT_TIME_BANK_SECONDS, DEFAULT_TURN_TIME_SECONDS, validateRoundConfig } from '../round';
import {
  MAX_REQUEST_ID_LENGTH,
  type ClientMessage,
  type ClientMessageType,
  type TableSettings,
  type TableSettingsInput,
} from './messages';

/** Standardwerte beim Erstellen eines Tisches (D-012: steigende Blinds; D-013: 20 s Zug, 60 s Zeitbank). */
export const DEFAULT_STARTING_STACK = 1500;
export const DEFAULT_TABLE_SETTINGS: Omit<TableSettings, 'name'> = {
  isPublic: true,
  maxSeats: 9,
  startingStack: DEFAULT_STARTING_STACK,
  blindStructure: DEFAULT_BLIND_STRUCTURE,
  turnTimeSeconds: DEFAULT_TURN_TIME_SECONDS,
  timeBankSeconds: DEFAULT_TIME_BANK_SECONDS,
};

export const TABLE_NAME_MAX_LENGTH = 50;
export const MIN_SEATS = 2;
export const MAX_SEATS = 9; // D-007
/** Grenzen der Zeit-Einstellungen (D-020): Zugzeit 10–120 s, Zeitbank 0–300 s. */
export const MIN_TURN_TIME_SECONDS = 10;
export const MAX_TURN_TIME_SECONDS = 120;
export const MIN_TIME_BANK_SECONDS = 0;
export const MAX_TIME_BANK_SECONDS = 300;
/** Startstack 1 … 10⁸ (D-015, wie `validateRoundConfig`). */
export const MAX_STARTING_STACK = 100_000_000;
/** Dauer eines Blind-Levels bei steigenden Blinds (Minuten). */
export const MIN_LEVEL_MINUTES = 1;
export const MAX_LEVEL_MINUTES = 1440;
const MAX_ID = 2 ** 31 - 1; // integer-IDs in Postgres (D-015)
const MAX_HAND_NUMBER = 2 ** 31 - 1;
const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

type Obj = Record<string, unknown>;

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

function int(o: Obj, key: string, min: number, max: number): number {
  const v = o[key];
  if (!isInt(v, min, max)) fail(`${key} muss eine ganze Zahl von ${String(min)} bis ${String(max)} sein`);
  return v;
}

function id(o: Obj, key: string): number {
  return int(o, key, 1, MAX_ID);
}

function wrap<T>(fn: () => T): Validated<T> {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, message: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Aktionen und Einstellungen
// ---------------------------------------------------------------------------

function action(v: unknown): Action {
  if (!isObject(v)) fail('action muss ein Objekt sein');
  switch (v['type']) {
    case 'fold':
    case 'check':
    case 'call':
    case 'allIn':
      return { type: v['type'] };
    case 'bet':
    case 'raise':
      return { type: v['type'], amount: int(v, 'amount', 1, Number.MAX_SAFE_INTEGER) };
    default:
      return fail('action.type muss fold, check, call, bet, raise oder allIn sein');
  }
}

function blindLevel(v: unknown): BlindLevel {
  if (!isObject(v)) fail('Blind-Level muss ein Objekt sein');
  if ('ante' in v) fail('Antes gibt es nicht (D-016)');
  return {
    smallBlind: int(v, 'smallBlind', 1, MAX_STARTING_STACK),
    bigBlind: int(v, 'bigBlind', 1, MAX_STARTING_STACK),
  };
}

function blindStructure(v: unknown): BlindStructure {
  if (!isObject(v)) fail('blindStructure muss ein Objekt sein');
  if (v['type'] === 'fixed') return { type: 'fixed', level: blindLevel(v['level']) };
  if (v['type'] === 'increasing') {
    const levels = v['levels'];
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > 100) {
      fail('levels muss 1–100 Level enthalten');
    }
    return {
      type: 'increasing',
      levels: levels.map(blindLevel),
      levelMinutes: int(v, 'levelMinutes', MIN_LEVEL_MINUTES, MAX_LEVEL_MINUTES),
    };
  }
  return fail('blindStructure.type muss fixed oder increasing sein');
}

function settings(v: unknown): TableSettings {
  if (!isObject(v)) fail('settings muss ein Objekt sein');
  const rawName = v['name'];
  if (typeof rawName !== 'string') fail('name muss ein Text sein');
  const name = rawName.trim();
  if (name.length < 1 || name.length > TABLE_NAME_MAX_LENGTH) {
    fail(`name muss 1–${String(TABLE_NAME_MAX_LENGTH)} Zeichen haben`);
  }
  const d = DEFAULT_TABLE_SETTINGS;
  const has = (key: keyof TableSettingsInput): boolean => v[key] !== undefined;
  if (has('isPublic') && typeof v['isPublic'] !== 'boolean') fail('isPublic muss true oder false sein');
  const result: TableSettings = {
    name,
    isPublic: has('isPublic') ? (v['isPublic'] as boolean) : d.isPublic,
    maxSeats: has('maxSeats') ? int(v, 'maxSeats', MIN_SEATS, MAX_SEATS) : d.maxSeats,
    startingStack: has('startingStack') ? int(v, 'startingStack', 1, MAX_STARTING_STACK) : d.startingStack,
    blindStructure: has('blindStructure') ? blindStructure(v['blindStructure']) : structuredCopy(d.blindStructure),
    turnTimeSeconds: has('turnTimeSeconds')
      ? int(v, 'turnTimeSeconds', MIN_TURN_TIME_SECONDS, MAX_TURN_TIME_SECONDS)
      : d.turnTimeSeconds,
    timeBankSeconds: has('timeBankSeconds')
      ? int(v, 'timeBankSeconds', MIN_TIME_BANK_SECONDS, MAX_TIME_BANK_SECONDS)
      : d.timeBankSeconds,
  };
  const roundError = validateRoundConfig({
    startingStack: result.startingStack,
    blindStructure: result.blindStructure,
    turnTimeSeconds: result.turnTimeSeconds,
    timeBankSeconds: result.timeBankSeconds,
  });
  if (roundError !== null) fail(roundError);
  const first = result.blindStructure.type === 'fixed' ? result.blindStructure.level : result.blindStructure.levels[0];
  if (first !== undefined && first.bigBlind > result.startingStack) {
    fail('Der Big Blind des ersten Levels darf nicht größer als der Startstack sein');
  }
  return result;
}

function structuredCopy(s: BlindStructure): BlindStructure {
  return s.type === 'fixed'
    ? { type: 'fixed', level: { ...s.level } }
    : { type: 'increasing', levels: s.levels.map((l) => ({ ...l })), levelMinutes: s.levelMinutes };
}

/** Prüft Tisch-Einstellungen und ergänzt Defaults. */
export function validateTableSettings(input: unknown): Validated<TableSettings> {
  return wrap(() => settings(input));
}

// ---------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------

const MESSAGE_TYPES: ReadonlySet<string> = new Set<ClientMessageType>([
  'hello',
  'ping',
  'lobby.subscribe',
  'lobby.unsubscribe',
  'table.create',
  'table.join',
  'table.leave',
  'table.sit',
  'table.stand',
  'table.start',
  'table.rematch',
  'table.action',
  'admin.revealCards',
]);

function message(o: Obj, type: ClientMessageType): ClientMessage {
  switch (type) {
    case 'hello':
      return { type, protocolVersion: int(o, 'protocolVersion', 0, MAX_ID) };
    case 'ping':
    case 'lobby.subscribe':
    case 'lobby.unsubscribe':
      return { type };
    case 'table.create':
      return { type, settings: settings(o['settings']) };
    case 'table.join': {
      const hasId = o['tableId'] !== undefined;
      const hasCode = o['inviteCode'] !== undefined;
      if (hasId === hasCode) fail('table.join braucht genau eins von tableId oder inviteCode');
      if (hasId) return { type, tableId: id(o, 'tableId') };
      const code = o['inviteCode'];
      if (typeof code !== 'string' || !INVITE_CODE_PATTERN.test(code)) fail('inviteCode ist ungültig');
      return { type, inviteCode: code };
    }
    case 'table.leave':
    case 'table.stand':
    case 'table.start':
    case 'table.rematch':
      return { type, tableId: id(o, 'tableId') };
    case 'table.sit':
    case 'admin.revealCards':
      return { type, tableId: id(o, 'tableId'), seat: int(o, 'seat', 0, MAX_SEATS - 1) };
    case 'table.action':
      return {
        type,
        tableId: id(o, 'tableId'),
        handNumber: int(o, 'handNumber', 1, MAX_HAND_NUMBER),
        seq: int(o, 'seq', 0, MAX_ID),
        action: action(o['action']),
      };
  }
}

export type ClientMessageParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: 'BAD_MESSAGE' | 'INVALID_SETTINGS'; message: string; requestId: string | null };

const bad = (message: string, requestId: string | null): ClientMessageParseResult => ({
  ok: false,
  code: 'BAD_MESSAGE',
  message,
  requestId,
});

/**
 * Parst und validiert eine eingehende Nachricht (JSON-Text). Liefert bei Fehlern einen deutschen Text und,
 * falls lesbar, die `requestId` des Absenders (für die Fehlermeldung).
 */
export function parseClientMessage(text: string): ClientMessageParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return bad('Nachricht ist kein gültiges JSON', null);
  }
  if (!isObject(data)) return bad('Nachricht muss ein JSON-Objekt sein', null);
  const rawRequestId = data['requestId'];
  let requestId: string | null = null;
  if (rawRequestId !== undefined) {
    if (typeof rawRequestId !== 'string' || rawRequestId.length > MAX_REQUEST_ID_LENGTH) {
      return bad(`requestId muss ein Text mit höchstens ${String(MAX_REQUEST_ID_LENGTH)} Zeichen sein`, null);
    }
    requestId = rawRequestId;
  }
  const type = data['type'];
  if (typeof type !== 'string' || !MESSAGE_TYPES.has(type)) {
    return bad(`Unbekannter Nachrichtentyp: ${typeof type === 'string' ? type : typeof type}`, requestId);
  }
  if (type === 'table.create') {
    const checked = validateTableSettings(data['settings']);
    if (!checked.ok) return { ok: false, code: 'INVALID_SETTINGS', message: checked.message, requestId };
  }
  const result = wrap(() => message(data, type as ClientMessageType));
  if (!result.ok) return bad(result.message, requestId);
  return { ok: true, message: requestId === null ? result.value : { ...result.value, requestId } };
}
