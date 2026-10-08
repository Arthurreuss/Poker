// Rangliste, Statistiken und Hand-Historie (WP-019). Formate: docs/ARCHITECTURE.md, Abschnitt „Statistiken“.
import type { Card } from '@poker/engine';
import { apiRequest } from './client';

export interface LeaderboardEntry {
  /** Gleiche Punkte = gleicher Platz. */
  rank: number;
  userId: number;
  name: string;
  points: number;
  rounds: number;
  wins: number;
}

/** Quote als Zähler/Nenner (Nenner 0 = keine Daten). */
export interface Rate {
  count: number;
  of: number;
}

export interface PlayerStats {
  player: { id: number; name: string };
  /** `null` = noch keine beendete Runde, nicht in der Rangliste (D-024). */
  rank: number | null;
  points: number;
  rounds: number;
  wins: number;
  hands: { hands: number; vpip: Rate; pfr: Rate; wtsd: Rate; wsd: Rate };
}

export interface RoundPlayerSummary {
  /** `null` = gelöschter Spieler. */
  name: string | null;
  seat: number;
  placement: number | null;
  points: number | null;
  isViewer: boolean;
}

export interface RoundSummary {
  id: number;
  tableName: string;
  status: 'finished' | 'aborted';
  startedAt: string;
  finishedAt: string;
  handCount: number;
  viewerParticipated: boolean;
  /** Öffentlicher Tisch – Ergebnis für alle Eingeloggten; private Runden liefert der Server nur Teilnehmern (D-024). */
  isPublic: boolean;
  players: RoundPlayerSummary[];
}

export interface HandWinner {
  seat: number | null;
  name: string | null;
  amount: number;
}

export interface HandSummary {
  id: number;
  handNumber: number;
  board: Card[];
  winners: HandWinner[];
  viewer: { holeCards: Card[]; net: number } | null;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandActionType = 'small_blind' | 'big_blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface HandDetail {
  id: number;
  roundId: number;
  handNumber: number;
  startedAt: string;
  smallBlind: number;
  bigBlind: number;
  buttonSeat: number;
  smallBlindSeat: number | null;
  bigBlindSeat: number;
  board: Card[];
  showdown: boolean;
  players: {
    seat: number;
    name: string | null;
    isViewer: boolean;
    startStack: number;
    endStack: number;
    folded: boolean;
    cards: 'shown' | 'mucked' | 'hidden';
    holeCards: Card[] | null;
    handDescription: string | null;
  }[];
  actions: {
    seq: number;
    street: Street;
    seat: number | null;
    name: string | null;
    action: HandActionType;
    amount: number;
    streetTotal: number;
    isAllIn: boolean;
    isAutomatic: boolean;
  }[];
  pots: { amount: number; winners: HandWinner[]; handDescription: string | null }[];
  winners: HandWinner[];
}

const opts = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });
const seg = (value: string) => encodeURIComponent(value);

export async function fetchLeaderboard(signal?: AbortSignal): Promise<LeaderboardEntry[]> {
  return (await apiRequest<{ players: LeaderboardEntry[] }>('/api/leaderboard', opts(signal))).players;
}

export function fetchPlayerStats(name: string, signal?: AbortSignal): Promise<PlayerStats> {
  return apiRequest<PlayerStats>(`/api/players/${seg(name)}/stats`, opts(signal));
}

/** Letzte Runden von `player` (ohne Angabe: eigene). */
export async function fetchRecentRounds(player?: string, signal?: AbortSignal): Promise<RoundSummary[]> {
  const query = player === undefined ? '' : `?player=${seg(player)}`;
  return (await apiRequest<{ rounds: RoundSummary[] }>(`/api/rounds/recent${query}`, opts(signal))).rounds;
}

/** Runde mit Händen; `hands: null` = Ergebnis eines öffentlichen Tisches ohne eigene Teilnahme (D-024). */
export function fetchRound(
  id: string,
  signal?: AbortSignal,
): Promise<{ round: RoundSummary; hands: HandSummary[] | null }> {
  return apiRequest(`/api/rounds/${seg(id)}`, opts(signal));
}

export async function fetchHand(id: string, signal?: AbortSignal): Promise<HandDetail> {
  return (await apiRequest<{ hand: HandDetail }>(`/api/hands/${seg(id)}`, opts(signal))).hand;
}
