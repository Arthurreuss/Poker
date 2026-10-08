// Anzeige-Helfer für Rangliste, Profil und Hand-Historie (WP-019).
import type { HandActionType, Rate, RoundPlayerSummary, Street } from '../api/stats';

export const DELETED_PLAYER = 'Gelöschter Spieler';

/** Anzeigename; gelöschte Accounts (`null`) heißen „Gelöschter Spieler“. */
export function playerName(name: string | null): string {
  return name ?? DELETED_PLAYER;
}

/** Quote in ganzen Prozent, „–“ ohne Daten. */
export function formatRate(rate: Rate): string {
  if (rate.of === 0) return '–';
  return `${String(Math.round((rate.count / rate.of) * 100))} %`;
}

const numberFormat = new Intl.NumberFormat('de-DE');

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function pointsLabel(points: number): string {
  return `${formatNumber(points)} ${points === 1 ? 'Punkt' : 'Punkte'}`;
}

export function handsLabel(hands: number): string {
  return `${formatNumber(hands)} ${hands === 1 ? 'Hand' : 'Hände'}`;
}

/** Gewinn/Verlust mit Vorzeichen: „+120“, „−40“, „±0“. */
export function formatNet(value: number): string {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;
}

/** Platz einer Runde; geteilte Plätze (D-018) werden markiert. */
export function placementLabel(player: RoundPlayerSummary, players: readonly RoundPlayerSummary[]): string {
  if (player.placement === null) return '–';
  const shared = players.filter((p) => p.placement === player.placement).length > 1;
  return `${String(player.placement)}.${shared ? ' (geteilt)' : ''}`;
}

/** Platz in der Rangliste; bei Punktgleichheit teilen sich Spieler den Platz. */
export function isSharedRank<T extends { rank: number }>(entry: T, all: readonly T[]): boolean {
  return all.filter((e) => e.rank === entry.rank).length > 1;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export const STREET_LABELS: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

/** Aktion als Text, z. B. „erhöht auf 120“, „Big Blind 20“. */
export function actionLabel(a: {
  action: HandActionType;
  amount: number;
  streetTotal: number;
  isAllIn: boolean;
}): string {
  const n = formatNumber;
  const text = {
    small_blind: `Small Blind ${n(a.amount)}`,
    big_blind: `Big Blind ${n(a.amount)}`,
    fold: 'foldet',
    check: 'checkt',
    call: `callt ${n(a.amount)}`,
    bet: `setzt ${n(a.amount)}`,
    raise: `erhöht auf ${n(a.streetTotal)}`,
  }[a.action];
  return a.isAllIn ? `${text} (All-in)` : text;
}
