// Kernlogik der CLI `admin:feedback` (src/cli/feedback.ts): Argumente lesen und Einträge als Text formatieren.
import type { FeedbackItem } from './store';
import { isFeedbackStatus, type FeedbackCategory, type FeedbackStatus } from './validation';

export const FEEDBACK_CLI_USAGE =
  'Aufruf: DATABASE_URL=… npm run admin:feedback -w @poker/server -- [--status new|read|done|all] [--limit N]';

export interface FeedbackCliArgs {
  /** `null` = alle Status. */
  status: FeedbackStatus | null;
  limit: number;
}

export const DEFAULT_CLI_LIMIT = 20;

/** Liest `--status` und `--limit` (auch `--status=new`); `null` bei falschem Aufruf. */
export function parseFeedbackCliArgs(args: readonly string[]): FeedbackCliArgs | null {
  const result: FeedbackCliArgs = { status: null, limit: DEFAULT_CLI_LIMIT };
  const tokens = args.flatMap((arg) => (arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg]));
  for (let i = 0; i < tokens.length; i += 1) {
    const name = tokens[i];
    const value = tokens[i + 1];
    if (value === undefined) return null;
    if (name === '--status') {
      if (value === 'all') result.status = null;
      else if (isFeedbackStatus(value)) result.status = value;
      else return null;
    } else if (name === '--limit') {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) return null;
      result.limit = limit;
    } else {
      return null;
    }
    i += 1;
  }
  return result;
}

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = { bug: 'Bug', idea: 'Idee', other: 'Sonstiges' };
export const STATUS_LABELS: Record<FeedbackStatus, string> = { new: 'neu', read: 'gelesen', done: 'erledigt' };

function formatDate(iso: string): string {
  // Lokale Zeit des Rechners, auf dem die CLI läuft, im Format JJJJ-MM-TT HH:MM.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Ein Eintrag als Textblock: Kopfzeile, eingerückter Text, Kontextzeilen. */
export function formatFeedbackItem(item: FeedbackItem): string {
  const who = item.username ?? (item.userId === null ? 'gelöschter Account' : `User ${String(item.userId)}`);
  const head = `#${String(item.id)}  ${formatDate(item.createdAt)}  [${STATUS_LABELS[item.status]}]  ${CATEGORY_LABELS[item.category]}  von ${who}`;
  const body = item.message
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');
  const context = [
    item.page === null ? null : `Seite ${item.page}`,
    item.tableId === null ? null : `Tisch ${String(item.tableId)}`,
    item.appVersion === null ? null : `Version ${item.appVersion}`,
    item.orientation === null ? null : `Ausrichtung ${item.orientation}`,
  ].filter((x) => x !== null);
  const lines = [head, body];
  if (context.length > 0) lines.push(`    – ${context.join(' · ')}`);
  if (item.userAgent !== null) lines.push(`    – ${item.userAgent}`);
  return lines.join('\n');
}

export function formatFeedbackList(items: readonly FeedbackItem[], status: FeedbackStatus | null): string {
  if (items.length === 0) {
    return status === null ? 'Kein Feedback vorhanden.' : `Kein Feedback mit Status „${STATUS_LABELS[status]}“.`;
  }
  return items.map(formatFeedbackItem).join('\n\n');
}
