import { describe, expect, it } from 'vitest';
import { DEFAULT_BLIND_LEVELS } from '@poker/engine';
import { validateTableSettings } from '@poker/engine/protocol';
import { defaultCreateTableValues, validateCreateTableForm, type CreateTableFormValues } from './tableSettingsForm';

const base = (patch: Partial<CreateTableFormValues> = {}): CreateTableFormValues => ({
  ...defaultCreateTableValues('anna'),
  ...patch,
});

describe('Formular „Tisch erstellen“: Defaults und Ergebnis', () => {
  it('Defaults nach D-012/D-013/D-020: 1.500 Chips, steigend alle 10 min, 20 s Zug, 60 s Zeitbank, öffentlich', () => {
    const result = validateCreateTableForm(base());
    expect(result).toEqual({
      ok: true,
      settings: {
        name: 'Tisch von anna',
        isPublic: true,
        maxSeats: 9,
        startingStack: 1500,
        blindStructure: { type: 'increasing', levels: [...DEFAULT_BLIND_LEVELS], levelMinutes: 10 },
        turnTimeSeconds: 20,
        timeBankSeconds: 60,
      },
    });
  });

  it('feste Blinds ab gewähltem Level, privat, Ränder der Zeitgrenzen', () => {
    const result = validateCreateTableForm(
      base({
        name: '  Freitag  ',
        isPublic: false,
        maxSeats: '2',
        startingStack: '500',
        blindLevel: '2',
        blindMode: 'fixed',
        levelMinutes: 'egal',
        turnTimeSeconds: '120',
        timeBankSeconds: '0',
      }),
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        name: 'Freitag',
        isPublic: false,
        maxSeats: 2,
        startingStack: 500,
        blindStructure: { type: 'fixed', level: { smallBlind: 25, bigBlind: 50 } },
        turnTimeSeconds: 120,
        timeBankSeconds: 0,
      },
    });
  });

  it('steigend ab einem höheren Level: Struktur beginnt dort', () => {
    const result = validateCreateTableForm(base({ blindLevel: '3', levelMinutes: '15' }));
    if (!result.ok) throw new Error('ungültig');
    expect(result.settings.blindStructure).toMatchObject({ type: 'increasing', levelMinutes: 15 });
    if (result.settings.blindStructure.type !== 'increasing') throw new Error('falscher Typ');
    expect(result.settings.blindStructure.levels[0]).toEqual({ smallBlind: 40, bigBlind: 80 });
  });

  it('jedes gültige Ergebnis besteht auch die Server-Prüfung', () => {
    const result = validateCreateTableForm(base({ startingStack: '20', blindLevel: '0', timeBankSeconds: '300' }));
    if (!result.ok) throw new Error('ungültig');
    expect(validateTableSettings(result.settings)).toEqual({ ok: true, value: result.settings });
  });
});

describe('Formular „Tisch erstellen“: Fehler je Feld (gleiche Grenzen wie der Server)', () => {
  it.each<[Partial<CreateTableFormValues>, keyof CreateTableFormValues, string]>([
    [{ name: '   ' }, 'name', 'Name fehlt'],
    [{ name: 'x'.repeat(51) }, 'name', 'Name darf höchstens 50 Zeichen haben'],
    [{ startingStack: '' }, 'startingStack', 'Startstack fehlt'],
    [{ startingStack: '0' }, 'startingStack', 'Startstack: 1–100.000.000'],
    [{ startingStack: '1,5' }, 'startingStack', 'Startstack muss eine ganze Zahl sein'],
    [{ startingStack: '100000001' }, 'startingStack', 'Startstack: 1–100.000.000'],
    [{ maxSeats: '10' }, 'maxSeats', 'Plätze: 2–9'],
    [{ turnTimeSeconds: '9' }, 'turnTimeSeconds', 'Zugzeit: 10–120 Sekunden'],
    [{ turnTimeSeconds: '121' }, 'turnTimeSeconds', 'Zugzeit: 10–120 Sekunden'],
    [{ timeBankSeconds: '-1' }, 'timeBankSeconds', 'Zeitbank muss eine ganze Zahl sein'],
    [{ timeBankSeconds: '301' }, 'timeBankSeconds', 'Zeitbank: 0–300 Sekunden'],
    [{ levelMinutes: '0' }, 'levelMinutes', 'Minuten pro Level: 1–1.440'],
    [{ blindLevel: '99' }, 'blindLevel', 'Bitte Start-Blinds wählen'],
    [
      { startingStack: '100', blindLevel: '5' },
      'blindLevel',
      'Big Blind (200) darf nicht größer als der Startstack sein',
    ],
  ])('%j → %s', (patch, field, message) => {
    const result = validateCreateTableForm(base(patch));
    expect(result).toEqual({ ok: false, errors: { [field]: message } });
  });

  it('Minuten pro Level zählen bei festen Blinds nicht', () => {
    expect(validateCreateTableForm(base({ blindMode: 'fixed', levelMinutes: '' })).ok).toBe(true);
  });

  it('meldet mehrere Fehler auf einmal', () => {
    const result = validateCreateTableForm(base({ name: '', turnTimeSeconds: '5', timeBankSeconds: '500' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['name', 'timeBankSeconds', 'turnTimeSeconds']);
  });
});
