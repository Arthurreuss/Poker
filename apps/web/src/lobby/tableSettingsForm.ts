// Formular „Tisch erstellen“ (WP-015): Werte, Defaults und Validierung mit denselben Grenzen wie der Server
// (`@poker/engine/protocol`, D-012/D-013/D-016/D-020). Zum Schluss prüft `validateTableSettings` – also exakt
// der Server-Code – das Ergebnis; die Feldprüfungen davor liefern nur verständliche Meldungen je Feld.
import { DEFAULT_BLIND_LEVELS, DEFAULT_LEVEL_MINUTES, type BlindStructure } from '@poker/engine';
import {
  DEFAULT_TABLE_SETTINGS,
  MAX_LEVEL_MINUTES,
  MAX_SEATS,
  MAX_STARTING_STACK,
  MAX_TIME_BANK_SECONDS,
  MAX_TURN_TIME_SECONDS,
  MIN_LEVEL_MINUTES,
  MIN_SEATS,
  MIN_TIME_BANK_SECONDS,
  MIN_TURN_TIME_SECONDS,
  TABLE_NAME_MAX_LENGTH,
  validateTableSettings,
  type TableSettings,
} from '@poker/engine/protocol';

/** Blind-Erhöhung: steigend alle X Minuten (Standard, D-012) oder fest. */
export type BlindMode = 'increasing' | 'fixed';

/** Rohwerte der Eingabefelder (Zahlen als Text, wie sie im Feld stehen). */
export interface CreateTableFormValues {
  name: string;
  isPublic: boolean;
  maxSeats: string;
  startingStack: string;
  /** Index in `DEFAULT_BLIND_LEVELS`: Blinds des ersten Levels. */
  blindLevel: string;
  blindMode: BlindMode;
  levelMinutes: string;
  turnTimeSeconds: string;
  timeBankSeconds: string;
}

export type CreateTableField = keyof CreateTableFormValues;
export type CreateTableErrors = Partial<Record<CreateTableField | 'form', string>>;

export type CreateTableResult = { ok: true; settings: TableSettings } | { ok: false; errors: CreateTableErrors };

/** Wählbare Start-Blinds (Small/Big Blind) = Level der Standard-Struktur. Keine Antes (D-016). */
export const BLIND_LEVEL_OPTIONS = DEFAULT_BLIND_LEVELS;

export function defaultCreateTableValues(username?: string): CreateTableFormValues {
  const d = DEFAULT_TABLE_SETTINGS;
  return {
    name: username === undefined ? '' : `Tisch von ${username}`.slice(0, TABLE_NAME_MAX_LENGTH),
    isPublic: d.isPublic,
    maxSeats: String(d.maxSeats),
    startingStack: String(d.startingStack),
    blindLevel: '0',
    blindMode: 'increasing',
    levelMinutes: String(DEFAULT_LEVEL_MINUTES),
    turnTimeSeconds: String(d.turnTimeSeconds),
    timeBankSeconds: String(d.timeBankSeconds),
  };
}

const INTEGER = /^\d+$/;
const format = (n: number) => n.toLocaleString('de-DE');

/** Ganze Zahl im Bereich, sonst Fehlermeldung. */
function intField(raw: string, label: string, min: number, max: number, unit = ''): number | string {
  const text = raw.trim();
  if (text === '') return `${label} fehlt`;
  if (!INTEGER.test(text)) return `${label} muss eine ganze Zahl sein`;
  const value = Number(text);
  if (value < min || value > max) return `${label}: ${format(min)}–${format(max)}${unit}`;
  return value;
}

/** Prüft das Formular; bei Erfolg die fertigen Tisch-Einstellungen für `table.create`. */
export function validateCreateTableForm(values: CreateTableFormValues): CreateTableResult {
  const errors: CreateTableErrors = {};
  const take = (field: CreateTableField, result: number | string): number => {
    if (typeof result === 'string') {
      errors[field] = result;
      return 0;
    }
    return result;
  };

  const name = values.name.trim();
  if (name === '') errors.name = 'Name fehlt';
  else if (name.length > TABLE_NAME_MAX_LENGTH) {
    errors.name = `Name darf höchstens ${String(TABLE_NAME_MAX_LENGTH)} Zeichen haben`;
  }
  const maxSeats = take('maxSeats', intField(values.maxSeats, 'Plätze', MIN_SEATS, MAX_SEATS));
  const startingStack = take('startingStack', intField(values.startingStack, 'Startstack', 1, MAX_STARTING_STACK));
  const turnTimeSeconds = take(
    'turnTimeSeconds',
    intField(values.turnTimeSeconds, 'Zugzeit', MIN_TURN_TIME_SECONDS, MAX_TURN_TIME_SECONDS, ' Sekunden'),
  );
  const timeBankSeconds = take(
    'timeBankSeconds',
    intField(values.timeBankSeconds, 'Zeitbank', MIN_TIME_BANK_SECONDS, MAX_TIME_BANK_SECONDS, ' Sekunden'),
  );

  const level = BLIND_LEVEL_OPTIONS[Number(values.blindLevel)];
  if (!INTEGER.test(values.blindLevel) || level === undefined) {
    errors.blindLevel = 'Bitte Start-Blinds wählen';
  } else if (errors.startingStack === undefined && level.bigBlind > startingStack) {
    errors.blindLevel = `Big Blind (${format(level.bigBlind)}) darf nicht größer als der Startstack sein`;
  }
  let blindStructure: BlindStructure | null = null;
  if (values.blindMode === 'fixed') {
    if (level !== undefined) blindStructure = { type: 'fixed', level: { ...level } };
  } else {
    const levelMinutes = take(
      'levelMinutes',
      intField(values.levelMinutes, 'Minuten pro Level', MIN_LEVEL_MINUTES, MAX_LEVEL_MINUTES),
    );
    if (level !== undefined) {
      blindStructure = {
        type: 'increasing',
        levels: BLIND_LEVEL_OPTIONS.slice(Number(values.blindLevel)).map((l) => ({ ...l })),
        levelMinutes,
      };
    }
  }

  if (Object.keys(errors).length > 0 || blindStructure === null) return { ok: false, errors };

  // Gleiche Prüfung wie auf dem Server (Protokoll); fängt alles ab, was die Feldprüfungen nicht kennen.
  const checked = validateTableSettings({
    name,
    isPublic: values.isPublic,
    maxSeats,
    startingStack,
    blindStructure,
    turnTimeSeconds,
    timeBankSeconds,
  });
  if (!checked.ok) return { ok: false, errors: { form: checked.message } };
  return { ok: true, settings: checked.value };
}

/** Kurzbeschreibung der Blinds für Listen: „10/20“. */
export function formatBlinds(level: { smallBlind: number; bigBlind: number }): string {
  return `${format(level.smallBlind)}/${format(level.bigBlind)}`;
}

export { format as formatNumber };
