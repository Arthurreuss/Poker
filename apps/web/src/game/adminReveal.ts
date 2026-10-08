// Admin deckt verdeckte Karten auf (WP-033, D-027) – Zustand im Client, rein und ohne React. Der Server schickt
// fremde Karten nur auf Anfrage (`admin.revealCards` → `admin.cards`) und nur an die Admin-Verbindung. Hier wird nur
// gemerkt, welche Plätze gerade umgedreht sind; Zurückdrehen und erneutes Umdrehen derselben Hand brauchen keine
// neue Anfrage (Cache). Endet die Hand, vergisst der Client alle Karten.
import type { Card } from '@poker/engine';
import type { AdminCardsMessage, TableView as ServerTableView } from '@poker/engine/protocol';

export interface AdminRevealState {
  /** Hand, zu der die Karten gehören (`handNumber`); `null` = keine laufende Hand. */
  readonly handNumber: number | null;
  /** Vom Server erhaltene Karten je Platz (nur diese Hand). */
  readonly cards: ReadonlyMap<number, readonly Card[]>;
  /** Plätze, deren Karten gerade aufgedeckt sind. */
  readonly faceUp: ReadonlySet<number>;
  /** Angefragt, Antwort steht noch aus (wird nach Ankunft aufgedeckt). */
  readonly pending: ReadonlySet<number>;
}

export const EMPTY_REVEAL: AdminRevealState = {
  handNumber: null,
  cards: new Map(),
  faceUp: new Set(),
  pending: new Set(),
};

/** Laufende Hand der Sicht (`betting`); nach Handende `null`. */
function runningHand(table: ServerTableView | null): number | null {
  const hand = table?.round?.hand;
  return hand !== null && hand !== undefined && hand.phase === 'betting' ? hand.handNumber : null;
}

/** Nach jedem `table.state`: andere oder beendete Hand → alles vergessen. */
export function syncReveal(state: AdminRevealState, table: ServerTableView | null): AdminRevealState {
  const handNumber = runningHand(table);
  if (handNumber === state.handNumber) return state;
  return { ...EMPTY_REVEAL, handNumber };
}

/**
 * Tipp auf die Karten eines Platzes. Liefert den neuen Zustand und ob beim Server angefragt werden muss
 * (nur beim ersten Aufdecken eines Platzes in dieser Hand).
 */
export function toggleReveal(state: AdminRevealState, seat: number): { state: AdminRevealState; request: boolean } {
  if (state.handNumber === null) return { state, request: false };
  if (state.faceUp.has(seat)) {
    const faceUp = new Set(state.faceUp);
    faceUp.delete(seat);
    return { state: { ...state, faceUp }, request: false };
  }
  if (state.cards.has(seat)) return { state: { ...state, faceUp: new Set(state.faceUp).add(seat) }, request: false };
  if (state.pending.has(seat)) {
    // Erneuter Tipp, bevor die Antwort da ist: Wunsch zurücknehmen (die Karten werden trotzdem gemerkt).
    const pending = new Set(state.pending);
    pending.delete(seat);
    return { state: { ...state, pending }, request: false };
  }
  return { state: { ...state, pending: new Set(state.pending).add(seat) }, request: true };
}

/** Antwort `admin.cards`: nur für die laufende Hand übernehmen; war der Platz angefragt, aufdecken. */
export function receiveRevealedCards(state: AdminRevealState, message: AdminCardsMessage): AdminRevealState {
  if (message.handNumber !== state.handNumber) return state;
  const cards = new Map(state.cards).set(message.seat, [...message.cards]);
  const pending = new Set(state.pending);
  const wanted = pending.delete(message.seat);
  return { ...state, cards, pending, faceUp: wanted ? new Set(state.faceUp).add(message.seat) : state.faceUp };
}

/** Anfrage abgelehnt (Fehler vom Server): offene Anfragen verwerfen. */
export function clearPending(state: AdminRevealState): AdminRevealState {
  return state.pending.size === 0 ? state : { ...state, pending: new Set() };
}
