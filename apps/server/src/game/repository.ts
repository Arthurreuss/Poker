// Speicherung der Tische und Runden (WP-011): Schnittstelle + In-Memory-Implementierung (Tests ohne DB).
// Die Postgres-Implementierung liegt in `pg-repository.ts`. Ausführliche Hand-Historie: WP-013 (Hooks).
import type { TableSettings } from '@poker/engine/protocol';

export interface NewTable {
  createdBy: number;
  settings: TableSettings;
  inviteCode: string;
}

export interface RoundSeatRecord {
  userId: number;
  seat: number;
}

export interface RoundResultRecord {
  userId: number;
  /** 1 = Sieger; geteilte Plätze möglich (WP-008). */
  placement: number;
  points: number;
}

export interface TableRepository {
  /** Legt den Tisch an (Status `open`) und liefert seine ID. */
  createTable(table: NewTable): Promise<number>;
  /** Tisch auf `running`, Runde mit Teilnehmern anlegen; liefert die Runden-ID. */
  startRound(tableId: number, players: readonly RoundSeatRecord[]): Promise<number>;
  /** Runde `finished` mit Platzierungen und Punkten, Tisch `closed`. */
  finishRound(tableId: number, roundId: number, results: readonly RoundResultRecord[]): Promise<void>;
  /** Verlassenen offenen Tisch schließen (`closed`). */
  closeTable(tableId: number): Promise<void>;
}

export interface MemoryTableRecord extends NewTable {
  id: number;
  status: 'open' | 'running' | 'closed';
}

export interface MemoryRoundRecord {
  id: number;
  tableId: number;
  status: 'running' | 'finished';
  players: (RoundSeatRecord & { placement: number | null; points: number | null })[];
}

/** Hält alles im Speicher – für Tests und das reine Tischmodell ohne Datenbank. */
export class InMemoryTableRepository implements TableRepository {
  readonly tables = new Map<number, MemoryTableRecord>();
  readonly rounds = new Map<number, MemoryRoundRecord>();
  private nextTableId = 1;
  private nextRoundId = 1;

  createTable(table: NewTable): Promise<number> {
    const id = this.nextTableId++;
    this.tables.set(id, { ...table, id, status: 'open' });
    return Promise.resolve(id);
  }

  startRound(tableId: number, players: readonly RoundSeatRecord[]): Promise<number> {
    const table = this.table(tableId);
    table.status = 'running';
    const id = this.nextRoundId++;
    this.rounds.set(id, {
      id,
      tableId,
      status: 'running',
      players: players.map((p) => ({ ...p, placement: null, points: null })),
    });
    return Promise.resolve(id);
  }

  finishRound(tableId: number, roundId: number, results: readonly RoundResultRecord[]): Promise<void> {
    const round = this.rounds.get(roundId);
    if (round === undefined) return Promise.reject(new Error(`Runde ${String(roundId)} unbekannt`));
    round.status = 'finished';
    for (const r of results) {
      const p = round.players.find((x) => x.userId === r.userId);
      if (p === undefined) return Promise.reject(new Error(`User ${String(r.userId)} nicht in Runde`));
      p.placement = r.placement;
      p.points = r.points;
    }
    this.table(tableId).status = 'closed';
    return Promise.resolve();
  }

  closeTable(tableId: number): Promise<void> {
    this.table(tableId).status = 'closed';
    return Promise.resolve();
  }

  private table(id: number): MemoryTableRecord {
    const table = this.tables.get(id);
    if (table === undefined) throw new Error(`Tisch ${String(id)} unbekannt`);
    return table;
  }
}
