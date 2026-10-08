// Auth-Endpunkte des Servers (WP-010, Formate: docs/ARCHITECTURE.md „Auth“).
import { apiRequest } from './client';

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface Credentials {
  username: string;
  password: string;
}

interface UserResponse {
  user: User;
}

/** Legt einen Account an; der Server setzt direkt das Session-Cookie. */
export async function register(credentials: Credentials): Promise<User> {
  return (await apiRequest<UserResponse>('/api/register', { method: 'POST', body: credentials })).user;
}

export async function login(credentials: Credentials): Promise<User> {
  return (await apiRequest<UserResponse>('/api/login', { method: 'POST', body: credentials })).user;
}

export async function logout(): Promise<void> {
  await apiRequest<undefined>('/api/logout', { method: 'POST' });
}

/** Aktueller User; wirft `ApiError` mit Status 401, wenn nicht eingeloggt. */
export async function me(signal?: AbortSignal): Promise<User> {
  return (await apiRequest<UserResponse>('/api/me', signal === undefined ? {} : { signal })).user;
}

/** Löscht das eigene Konto (WP-022, Passwort als Bestätigung). Der Server anonymisiert es und beendet alle Sessions. */
export async function deleteAccount(password: string): Promise<void> {
  await apiRequest<undefined>('/api/me', { method: 'DELETE', body: { password } });
}
