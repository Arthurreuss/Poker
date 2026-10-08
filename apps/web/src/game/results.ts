// Texte für Showdown und Rundenende (WP-018): rein, aus der gefilterten Server-Sicht.
import type { StandingView, TableView as ServerTableView } from '@poker/engine/protocol';
import { formatChips } from '../table/format';

export interface PotResultLine {
  /** „Pot“, „Main Pot“, „Side Pot 1“ … */
  readonly label: string;
  readonly winners: readonly string[];
  readonly amount: number;
  /** Beschreibung der Gewinnerhand (deutsch, vom Server); `null` = ohne Showdown gewonnen. */
  readonly hand: string | null;
}

export interface HandResult {
  readonly handNumber: number;
  readonly lines: readonly PotResultLine[];
  /** Eigene Hand im Showdown (auch wenn gemuckt). */
  readonly ownHand: string | null;
}

function namesBySeat(table: ServerTableView): Map<string, string> {
  return new Map(table.seats.map((s) => [String(s.user.id), s.user.username]));
}

/** Ergebnis der zuletzt beendeten Hand; `null`, solange keine Hand beendet ist. */
export function handResult(table: ServerTableView): HandResult | null {
  const hand = table.round?.hand;
  if (hand === null || hand === undefined || hand.phase !== 'complete') return null;
  const names = namesBySeat(table);
  const name = (id: string) => names.get(id) ?? '?';
  const me = String(table.you.userId);

  if (hand.showdown === null) {
    // Alle anderen haben gefoldet: Gewinner bekommt alles (inkl. zurückgegebener Einsätze).
    const lines = (hand.payouts ?? []).map((p) => ({
      label: 'Pot',
      winners: [name(p.playerId)],
      amount: p.amount,
      hand: null,
    }));
    return { handNumber: hand.handNumber, lines, ownHand: null };
  }

  const pots = hand.showdown.pots;
  const lines = pots
    .filter((pot) => pot.amount > 0)
    .map((pot, i, all) => ({
      label: all.length === 1 ? 'Pot' : i === 0 ? 'Main Pot' : `Side Pot ${String(i)}`,
      winners: pot.winnerIds.map(name),
      amount: pot.amount,
      hand: pot.winningHand?.description ?? null,
    }));
  const own = hand.showdown.reveals.find((r) => r.playerId === me)?.hand?.description ?? null;
  return { handNumber: hand.handNumber, lines, ownHand: own };
}

/** Eine Zeile wie „Lena gewinnt 1.200 mit Full House, …“. */
export function describePotResult(line: PotResultLine): string {
  const who = line.winners.join(' und ');
  const verb = line.winners.length > 1 ? 'teilen sich' : 'gewinnt';
  const what = `${who} ${verb} ${formatChips(line.amount)}`;
  return line.hand === null ? what : `${what} – ${line.hand}`;
}

export interface StandingRow {
  readonly userId: number;
  readonly name: string;
  /** „1.“, bei geteilten Plätzen „3.–4.“ (D-018). */
  readonly place: string;
  readonly shared: boolean;
  readonly points: number;
  readonly isYou: boolean;
}

/** Platzierungen sortiert, geteilte Plätze als Bereich (D-018: gleicher Platz, gemittelte Punkte). */
export function standingRows(standings: readonly StandingView[], youUserId: number | null): StandingRow[] {
  const sorted = [...standings].sort((a, b) => a.placement - b.placement || a.seat - b.seat);
  const counts = new Map<number, number>();
  for (const s of sorted) counts.set(s.placement, (counts.get(s.placement) ?? 0) + 1);
  return sorted.map((s) => {
    const n = counts.get(s.placement) ?? 1;
    const shared = s.sharedPlacement && n > 1;
    return {
      userId: s.user.id,
      name: s.user.username,
      place: shared ? `${String(s.placement)}.–${String(s.placement + n - 1)}.` : `${String(s.placement)}.`,
      shared,
      points: s.points,
      isYou: s.user.id === youUserId,
    };
  });
}
