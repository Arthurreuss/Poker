// Letzte Aktion je Spieler (WP-037): aus dem öffentlichen Hand-Log der Server-Sicht (D-003, nichts Verdecktes).
// Rein und unit-getestet; der Adapter (`adapter.ts`) legt das Ergebnis als `lastAction` an die Sitze.
import type { HandEvent, HandPhase, Street } from '@poker/engine';
import type { LastActionView } from '../table/types';

/** Was aus der Hand gebraucht wird (Teil von `HandView` des Protokolls). */
export interface HandLogSource {
  readonly phase: HandPhase;
  readonly street: Street;
  readonly log: readonly HandEvent[];
}

function toView(event: HandEvent): LastActionView | null {
  if (event.allIn && (event.type === 'call' || event.type === 'bet' || event.type === 'raise')) {
    return { kind: 'allIn', amount: event.amount };
  }
  switch (event.type) {
    case 'check':
    case 'fold':
      return { kind: event.type };
    case 'call':
      return { kind: 'call', amount: event.amount };
    case 'bet':
    case 'raise':
      return { kind: event.type, amount: event.to };
    default:
      // Ante und Blinds sind Pflichteinsätze, keine Entscheidung – kein Schriftzug.
      return null;
  }
}

/**
 * Letzte Aktion je Spieler-ID in der laufenden Straße. Neue Straße → leer (das Log der Straße beginnt neu);
 * nach der Hand (`complete`) ebenfalls leer, dann zeigt der Tisch das Ergebnis.
 */
export function lastActionsOf(hand: HandLogSource): Map<string, LastActionView> {
  const result = new Map<string, LastActionView>();
  if (hand.phase !== 'betting') return result;
  for (const event of hand.log) {
    if (event.street !== hand.street) continue;
    const view = toView(event);
    if (view !== null) result.set(event.playerId, view);
  }
  return result;
}
