// Admin deckt verdeckte Karten eines Mitspielers auf (WP-033, D-027). Eigenes Modul, damit `GameServer` nur die
// Nachricht weiterreicht. Regeln: nur Admins (Flag aus der Session, zusätzlich beim Protokollieren aus der DB geprüft),
// nur am Tisch, an dem sie sitzen, nur in einer laufenden Hand, nur Mitspieler mit Karten (nicht gefoldet). Die Karten
// gehen nur an die anfragende Verbindung (`admin.cards`), nie in `table.state` oder an andere.
import type { Card } from '@poker/engine';
import type { ErrorCode } from '@poker/engine/protocol';
import { playerIdOf, type Table } from './table';

/** Was ins Admin-Protokoll kommt (`table.reveal_cards`, Quelle `ws`). */
export interface CardRevealAudit {
  adminId: number;
  tableId: number;
  targetUserId: number;
  roundId: number;
  handNumber: number;
  seat: number;
}

/**
 * Schreibt den Protokolleintrag und prüft dabei, ob der User (noch) Admin ist. `false` = kein Admin → Karten nicht
 * herausgeben. Betrieb: `recordCardReveal` (admin/reveal.ts). Ohne Senke ist Aufdecken abgeschaltet.
 */
export type CardRevealAuditSink = (entry: CardRevealAudit) => Promise<boolean>;

type Failure = { ok: false; code: ErrorCode; message: string };

export type RevealResult = { ok: true; handNumber: number; seat: number; cards: Card[] } | Failure;

const fail = (code: ErrorCode, message: string): Failure => ({ ok: false, code, message });

interface Target {
  roundId: number;
  handNumber: number;
  seat: number;
  userId: number;
  cards: Card[];
}

/**
 * Bereits protokollierte Aufdeckungen je Tisch für die laufende Hand: dieselben Karten in derselben Hand werden nur
 * einmal protokolliert (erneutes Anfordern, z. B. nach einem Reload, schreibt keinen zweiten Eintrag).
 */
export class CardRevealer {
  /** Tisch → { Hand-Schlüssel, protokollierte `adminId:seat` }. */
  private readonly logged = new Map<number, { hand: string; keys: Set<string> }>();

  constructor(private readonly audit: CardRevealAuditSink | undefined) {}

  /** `isAdmin`: Flag aus der Session der Verbindung (nie vom Client). */
  async reveal(table: Table, user: { id: number; isAdmin: boolean }, seat: number): Promise<RevealResult> {
    if (!user.isAdmin || this.audit === undefined) {
      return fail('FORBIDDEN', 'Nur Admins können verdeckte Karten aufdecken');
    }
    const checked = this.target(table, user.id, seat);
    if (!checked.ok) return checked;
    const target = checked.target;
    const handKey = `${String(target.roundId)}/${String(target.handNumber)}`;
    const key = `${String(user.id)}:${String(seat)}`;
    let entry = this.logged.get(table.id);
    if (entry?.hand !== handKey) {
      entry = { hand: handKey, keys: new Set() };
      this.logged.set(table.id, entry);
    }
    if (!entry.keys.has(key)) {
      const allowed = await this.audit({
        adminId: user.id,
        tableId: table.id,
        targetUserId: target.userId,
        roundId: target.roundId,
        handNumber: target.handNumber,
        seat,
      });
      if (!allowed) return fail('FORBIDDEN', 'Nur Admins können verdeckte Karten aufdecken');
      // Während des Schreibens kann eine neue Hand begonnen haben – dann gilt der Cache dieser Hand nicht mehr.
      if (this.logged.get(table.id)?.hand === handKey) this.logged.get(table.id)?.keys.add(key);
      // Die Hand muss noch dieselbe sein und laufen (sonst keine Karten einer vergangenen Hand herausgeben).
      const again = this.target(table, user.id, seat);
      if (!again.ok) return again;
      if (again.target.roundId !== target.roundId || again.target.handNumber !== target.handNumber) {
        return fail('NO_HAND_IN_PROGRESS', 'Die Hand ist schon vorbei');
      }
      return { ok: true, handNumber: again.target.handNumber, seat, cards: again.target.cards };
    }
    return { ok: true, handNumber: target.handNumber, seat, cards: target.cards };
  }

  /** Tisch ist weg: Cache freigeben. */
  forget(tableId: number): void {
    this.logged.delete(tableId);
  }

  private target(table: Table, adminId: number, seat: number): { ok: true; target: Target } | Failure {
    if (table.seatOf(adminId) === null) return fail('NOT_SEATED', 'Nur wer am Tisch sitzt, kann Karten aufdecken');
    const round = table.round;
    const hand = round?.hand ?? null;
    if (
      round === null ||
      hand === null ||
      round.phase !== 'hand' ||
      hand.phase !== 'betting' ||
      table.roundId === null
    ) {
      return fail('NO_HAND_IN_PROGRESS', 'Gerade läuft keine Hand');
    }
    const user = table.seats.get(seat);
    if (user === undefined || user.id === adminId)
      return fail('INVALID_SEAT', 'Auf diesem Platz gibt es nichts aufzudecken');
    const player = hand.players.find((p) => p.id === playerIdOf(user.id));
    if (player === undefined || player.status === 'folded' || player.holeCards.length === 0) {
      return fail('INVALID_SEAT', 'Auf diesem Platz gibt es nichts aufzudecken');
    }
    return {
      ok: true,
      target: {
        roundId: table.roundId,
        handNumber: round.handNumber,
        seat,
        userId: user.id,
        cards: [...player.holeCards],
      },
    };
  }
}
