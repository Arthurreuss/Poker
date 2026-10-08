import { describe, expect, it } from 'vitest';
import { DEFAULT_BLIND_STRUCTURE } from '../blind-structure';
import { AVATAR_IDS, REACTION_COOLDOWN_MS, REACTION_IDS, isAvatarId, isReactionId } from './avatars';
import { MAX_REQUEST_ID_LENGTH, PROTOCOL_VERSION } from './messages';
import {
  DEFAULT_STARTING_STACK,
  MAX_TIME_BANK_SECONDS,
  MAX_TURN_TIME_SECONDS,
  MIN_TURN_TIME_SECONDS,
  parseClientMessage,
  validateTableSettings,
} from './validate';

const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));

describe('parseClientMessage', () => {
  it.each([
    [{ type: 'hello', protocolVersion: PROTOCOL_VERSION }],
    [{ type: 'lobby.subscribe' }],
    [{ type: 'ping', requestId: 'p1' }],
    [{ type: 'lobby.unsubscribe', requestId: 'r1' }],
    [{ type: 'table.join', tableId: 3 }],
    [{ type: 'table.join', inviteCode: 'abc_DEF-123' }],
    [{ type: 'table.leave', tableId: 3 }],
    [{ type: 'table.sit', tableId: 3, seat: 8 }],
    [{ type: 'table.stand', tableId: 3 }],
    [{ type: 'table.start', tableId: 3 }],
    [{ type: 'table.rematch', tableId: 3, requestId: 'n1' }],
    [{ type: 'table.action', tableId: 3, handNumber: 1, seq: 2, action: { type: 'fold' } }],
    [{ type: 'table.action', tableId: 3, handNumber: 1, seq: 2, action: { type: 'raise', amount: 60 } }],
    [{ type: 'table.react', tableId: 3, reaction: 'thumbs-up' }],
    [{ type: 'table.react', tableId: 3, reaction: 'fire', requestId: 'e1' }],
  ])('akzeptiert %j', (msg) => {
    const result = parse(msg);
    expect(result).toEqual({ ok: true, message: msg });
  });

  it('übernimmt nur bekannte Felder', () => {
    const result = parse({ type: 'table.start', tableId: 1, extra: 'x', __proto__: { admin: true } });
    expect(result).toEqual({ ok: true, message: { type: 'table.start', tableId: 1 } });
  });

  it.each([
    ['kein JSON', '{type:'],
    ['Array', '[]'],
    ['null', 'null'],
    ['Zahl', '42'],
  ])('lehnt %s ab', (_name, text) => {
    expect(parseClientMessage(text)).toMatchObject({ ok: false, requestId: null });
  });

  it.each([
    [{ type: 'gibts-nicht' }],
    [{ type: 42 }],
    [{}],
    [{ type: 'hello' }],
    [{ type: 'hello', protocolVersion: '1' }],
    [{ type: 'table.join' }],
    [{ type: 'table.join', tableId: 1, inviteCode: 'abc' }],
    [{ type: 'table.join', inviteCode: 'mit leerzeichen' }],
    [{ type: 'table.join', tableId: 0 }],
    [{ type: 'table.sit', tableId: 1, seat: 9 }],
    [{ type: 'table.sit', tableId: 1, seat: -1 }],
    [{ type: 'table.sit', tableId: 1, seat: 1.5 }],
    [{ type: 'table.start', tableId: '1' }],
    [{ type: 'table.rematch' }],
    [{ type: 'table.rematch', tableId: 0 }],
    [{ type: 'table.action', tableId: 1, handNumber: 1, seq: 0 }],
    [{ type: 'table.action', tableId: 1, handNumber: 1, seq: 0, action: { type: 'raise' } }],
    [{ type: 'table.action', tableId: 1, handNumber: 1, seq: 0, action: { type: 'bet', amount: -5 } }],
    [{ type: 'table.action', tableId: 1, handNumber: 1, seq: 0, action: { type: 'bet', amount: 1e300 } }],
    [{ type: 'table.action', tableId: 1, handNumber: 1, seq: 0, action: { type: 'ante' } }],
    [{ type: 'table.action', tableId: 1, handNumber: 0, seq: 0, action: { type: 'fold' } }],
    [{ type: 'table.create' }],
    [{ type: 'table.create', settings: { name: '' } }],
    [{ type: 'table.react', tableId: 3 }],
    [{ type: 'table.react', tableId: 3, reaction: 'poop' }],
    [{ type: 'table.react', tableId: 3, reaction: '👍' }],
    [{ type: 'table.react', reaction: 'clap' }],
  ])('lehnt %j ab', (msg) => {
    const result = parse(msg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toEqual(expect.any(String));
  });

  it('ungültige Tisch-Einstellungen → INVALID_SETTINGS, sonst BAD_MESSAGE', () => {
    expect(parse({ type: 'table.create', settings: { name: 'a', maxSeats: 10 } })).toMatchObject({
      ok: false,
      code: 'INVALID_SETTINGS',
    });
    expect(parse({ type: 'table.sit', tableId: 1 })).toMatchObject({ ok: false, code: 'BAD_MESSAGE' });
  });

  it('gibt die requestId bei Fehlern zurück', () => {
    expect(parse({ type: 'table.sit', tableId: 1, requestId: 'abc' })).toMatchObject({ ok: false, requestId: 'abc' });
  });

  it('lehnt zu lange oder falsch typisierte requestIds ab', () => {
    expect(parse({ type: 'lobby.subscribe', requestId: 'x'.repeat(MAX_REQUEST_ID_LENGTH + 1) }).ok).toBe(false);
    expect(parse({ type: 'lobby.subscribe', requestId: 5 }).ok).toBe(false);
  });
});

describe('Avatare und Reaktionen (WP-032)', () => {
  it('feste Auswahl: 24 Avatare, 8 Reaktionen, eindeutig und URL-tauglich', () => {
    expect(AVATAR_IDS).toHaveLength(24);
    expect(REACTION_IDS).toHaveLength(8);
    for (const ids of [AVATAR_IDS, REACTION_IDS]) {
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
  });

  it('isAvatarId/isReactionId akzeptieren nur bekannte IDs', () => {
    expect(isAvatarId('fox')).toBe(true);
    expect(isAvatarId('Fox')).toBe(false);
    expect(isAvatarId(null)).toBe(false);
    expect(isAvatarId('toString')).toBe(false);
    expect(isReactionId('clap')).toBe(true);
    expect(isReactionId('constructor')).toBe(false);
    expect(REACTION_COOLDOWN_MS).toBe(2000);
  });
});

describe('validateTableSettings', () => {
  it('ergänzt Defaults (D-012 steigende Blinds, D-013 Zeitlimit/Zeitbank)', () => {
    const result = validateTableSettings({ name: '  Freitagsrunde  ' });
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Freitagsrunde',
        isPublic: true,
        maxSeats: 9,
        startingStack: DEFAULT_STARTING_STACK,
        blindStructure: DEFAULT_BLIND_STRUCTURE,
        turnTimeSeconds: 20,
        timeBankSeconds: 60,
      },
    });
  });

  it('übernimmt eigene Werte', () => {
    const settings = {
      name: 'Privat',
      isPublic: false,
      maxSeats: 3,
      startingStack: 100,
      blindStructure: { type: 'fixed', level: { smallBlind: 5, bigBlind: 10 } },
      turnTimeSeconds: 30,
      timeBankSeconds: 0,
    };
    expect(validateTableSettings(settings)).toEqual({ ok: true, value: settings });
  });

  it.each([
    [{ name: 'x'.repeat(51) }],
    [{ name: '   ' }],
    [{ name: 'a', isPublic: 'ja' }],
    [{ name: 'a', maxSeats: 1 }],
    [{ name: 'a', maxSeats: 10 }],
    [{ name: 'a', startingStack: 0 }],
    [{ name: 'a', startingStack: 100_000_001 }],
    [{ name: 'a', turnTimeSeconds: 0 }],
    [{ name: 'a', turnTimeSeconds: 9 }],
    [{ name: 'a', turnTimeSeconds: 121 }],
    [{ name: 'a', turnTimeSeconds: 20.5 }],
    [{ name: 'a', timeBankSeconds: -1 }],
    [{ name: 'a', timeBankSeconds: 301 }],
    [{ name: 'a', blindStructure: { type: 'increasing', levels: [{ smallBlind: 1, bigBlind: 2 }], levelMinutes: 0 } }],
    [
      {
        name: 'a',
        blindStructure: { type: 'increasing', levels: [{ smallBlind: 1, bigBlind: 2 }], levelMinutes: 1441 },
      },
    ],
    [{ name: 'a', blindStructure: { type: 'fixed', level: { smallBlind: 20, bigBlind: 20 } } }],
    [{ name: 'a', blindStructure: { type: 'fixed', level: { smallBlind: 5, bigBlind: 10, ante: 1 } } }],
    [{ name: 'a', blindStructure: { type: 'increasing', levels: [], levelMinutes: 10 } }],
    [{ name: 'a', blindStructure: { type: 'increasing', levels: [{ smallBlind: 1, bigBlind: 2 }] } }],
    [{ name: 'a', blindStructure: { type: 'weird' } }],
    [{ name: 'a', startingStack: 10, blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } } }],
  ])('lehnt %j ab', (settings) => {
    expect(validateTableSettings(settings).ok).toBe(false);
  });
});

describe('Grenzen der Zeit-Einstellungen (D-020)', () => {
  it('Zugzeit 10–120 s, Zeitbank 0–300 s', () => {
    expect([MIN_TURN_TIME_SECONDS, MAX_TURN_TIME_SECONDS, MAX_TIME_BANK_SECONDS]).toEqual([10, 120, 300]);
    for (const [turnTimeSeconds, timeBankSeconds] of [
      [10, 0],
      [120, 300],
    ]) {
      const result = validateTableSettings({ name: 'a', turnTimeSeconds, timeBankSeconds });
      expect(result).toMatchObject({ ok: true, value: { turnTimeSeconds, timeBankSeconds } });
    }
  });

  it('Fehlermeldung nennt den erlaubten Bereich', () => {
    expect(validateTableSettings({ name: 'a', turnTimeSeconds: 5 })).toEqual({
      ok: false,
      message: 'turnTimeSeconds muss eine ganze Zahl von 10 bis 120 sein',
    });
  });
});
