// Admin-Endpunkte (WP-028/WP-029, nur Admins; Formate: docs/ARCHITECTURE.md, „Auth“ → „Admin (WP-028)“).
import { apiRequest } from './client';

export interface RoundCounts {
  started: number;
  finished: number;
  aborted: number;
  running: number;
}

export interface AdminOverview {
  generatedAt: string;
  tables: { total: number; open: number; running: number; seatedPlayers: number };
  onlineUsers: number;
  /** `null` = Datenbank nicht erreichbar. */
  rounds: { today: RoundCounts; week: RoundCounts; timeZone: string; weekDays: number } | null;
  feedbackNew: number | null;
  health: {
    db: 'ok' | 'error';
    dbLatencyMs: number | null;
    uptimeSeconds: number;
    nodeVersion: string;
    memoryMb: number;
  };
}

export interface AdminTablePlayer {
  seat: number;
  id: number;
  username: string;
  connected: boolean;
}

export interface AdminTable {
  id: number;
  name: string;
  isPublic: boolean;
  status: 'open' | 'running' | 'finished';
  createdBy: { id: number; username: string };
  maxSeats: number;
  players: AdminTablePlayer[];
  watchers: number;
  roundId: number | null;
  handNumber: number | null;
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  /** ISO-Zeitpunkt der Sperre, `null` = nicht gesperrt. */
  bannedAt: string | null;
  /** Gültige Sessions. */
  sessions: number;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  /** `bereich.aktion`, z. B. `user.ban`; künftige Codes (z. B. WP-033) erscheinen roh. */
  action: string;
  source: 'api' | 'cli' | 'ws';
  admin: { id: number; username: string } | null;
  targetUser: { id: number; username: string } | null;
  targetTableId: number | null;
  details: Record<string, unknown>;
}

export const AUDIT_PAGE_SIZE = 50;

const withSignal = (signal?: AbortSignal) => (signal === undefined ? {} : { signal });

export async function getAdminOverview(signal?: AbortSignal): Promise<AdminOverview> {
  return (await apiRequest<{ overview: AdminOverview }>('/api/admin/overview', withSignal(signal))).overview;
}

export async function listAdminTables(signal?: AbortSignal): Promise<AdminTable[]> {
  return (await apiRequest<{ tables: AdminTable[] }>('/api/admin/tables', withSignal(signal))).tables;
}

export async function closeAdminTable(id: number): Promise<{ roundAborted: boolean }> {
  return (
    await apiRequest<{ table: { roundAborted: boolean } }>(`/api/admin/tables/${String(id)}/close`, { method: 'POST' })
  ).table;
}

export async function listAdminUsers(search: string, signal?: AbortSignal): Promise<AdminUser[]> {
  const q = search.trim();
  const path = q === '' ? '/api/admin/users' : `/api/admin/users?search=${encodeURIComponent(q)}`;
  return (await apiRequest<{ users: AdminUser[] }>(path, withSignal(signal))).users;
}

export async function banAdminUser(id: number, reason: string): Promise<AdminUser> {
  const r = reason.trim();
  return (
    await apiRequest<{ user: AdminUser }>(`/api/admin/users/${String(id)}/ban`, {
      method: 'POST',
      body: r === '' ? {} : { reason: r },
    })
  ).user;
}

export async function unbanAdminUser(id: number): Promise<AdminUser> {
  return (await apiRequest<{ user: AdminUser }>(`/api/admin/users/${String(id)}/unban`, { method: 'POST' })).user;
}

export async function revokeAdminUserSessions(id: number): Promise<number> {
  return (await apiRequest<{ revoked: number }>(`/api/admin/users/${String(id)}/sessions/revoke`, { method: 'POST' }))
    .revoked;
}

/** Neues Zufallspasswort – steht nur in dieser Antwort (D-029). */
export async function resetAdminUserPassword(id: number): Promise<string> {
  return (await apiRequest<{ password: string }>(`/api/admin/users/${String(id)}/password`, { method: 'POST' }))
    .password;
}

/** Neueste zuerst; `before` = kleinste bisher geladene ID (Blättern). */
export async function listAudit(before: number | null, signal?: AbortSignal): Promise<AuditEntry[]> {
  const params = new URLSearchParams({ limit: String(AUDIT_PAGE_SIZE) });
  if (before !== null) params.set('before', String(before));
  return (await apiRequest<{ entries: AuditEntry[] }>(`/api/admin/audit?${params.toString()}`, withSignal(signal)))
    .entries;
}
