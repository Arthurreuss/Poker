// „Du bist dran“ überall in der App (ADR XXXX): beobachtet über die gemeinsame Verbindung jeden Tisch, an dem
// man sitzt, auch wenn die Tischseite zu ist, und meldet, an welchem Tisch man gerade am Zug ist.
// Ohne React; die Anzeige (Banner, Ton, Vibration, Titel) steckt in `TurnBanner`.
import type { ServerMessage, TableView } from '@poker/engine/protocol';
import type { GameConnection } from './connection';

export interface TurnAlert {
  readonly tableId: number;
  readonly tableName: string;
  /** Eindeutig je Zug (`Tisch/Hand/Aktion`): ein neuer Schlüssel heißt neuer Zug. */
  readonly key: string;
}

interface SeatedTable {
  readonly name: string;
  readonly turnKey: string | null;
}

/** Sitzt der Empfänger der Sicht an einem noch nicht beendeten Tisch? */
function seatedIn(table: TableView): boolean {
  return table.you.seat !== null && table.status !== 'finished';
}

/** Schlüssel des eigenen Zugs oder `null`, wenn man nicht am Zug ist. */
export function turnKeyOf(table: TableView): string | null {
  const clock = table.turnClock;
  if (clock === null || table.you.seat === null || clock.seat !== table.you.seat) return null;
  return `${String(table.id)}/${String(clock.handNumber)}/${String(clock.actionSeq)}`;
}

/**
 * Hält jeden Tisch, an dem man sitzt, auf der Verbindung (`watchTable`), damit der Server weiter
 * `table.state` schickt und man als verbunden gilt; gibt ihn frei, sobald man aufsteht, die Runde
 * beendet ist, der Tisch schließt oder man ihn verlässt.
 */
export class TurnWatcher {
  private readonly seated = new Map<number, SeatedTable>();
  private alert: TurnAlert | null = null;
  private readonly listeners = new Set<() => void>();
  private off: (() => void)[] = [];

  constructor(private readonly connection: GameConnection) {}

  start(): void {
    if (this.off.length > 0) return;
    this.off = [
      this.connection.onMessage((m) => {
        this.handle(m);
      }),
      this.connection.onStatus((status) => {
        if (status.kind === 'open') return;
        // Bis zum nächsten `table.state` ist unklar, wer dran ist.
        for (const [id, entry] of this.seated) this.seated.set(id, { ...entry, turnKey: null });
        this.refresh();
      }),
    ];
  }

  stop(): void {
    for (const off of this.off) off();
    this.off = [];
    for (const id of [...this.seated.keys()]) this.drop(id);
    this.refresh();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Tisch, an dem man gerade am Zug ist (bei mehreren der mit der kleinsten ID), sonst `null`. */
  readonly getSnapshot = (): TurnAlert | null => this.alert;

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'table.state': {
        const table = message.table;
        if (!seatedIn(table)) {
          this.drop(table.id);
        } else {
          if (!this.seated.has(table.id)) this.connection.watchTable(table.id);
          this.seated.set(table.id, { name: table.settings.name, turnKey: turnKeyOf(table) });
        }
        break;
      }
      case 'table.left':
      case 'table.closed':
        this.drop(message.tableId);
        break;
      case 'error':
        if (message.code === 'TABLE_NOT_FOUND' && message.tableId !== null) this.drop(message.tableId);
        break;
      default:
        return;
    }
    this.refresh();
  }

  private drop(tableId: number): void {
    if (!this.seated.delete(tableId)) return;
    this.connection.unwatchTable(tableId);
  }

  private refresh(): void {
    let next: TurnAlert | null = null;
    for (const id of [...this.seated.keys()].sort((a, b) => a - b)) {
      const entry = this.seated.get(id);
      if (entry === undefined || entry.turnKey === null) continue;
      next = { tableId: id, tableName: entry.name, key: entry.turnKey };
      break;
    }
    if (next?.key === this.alert?.key) return;
    this.alert = next;
    for (const listener of [...this.listeners]) listener();
  }
}
