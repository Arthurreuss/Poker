import { describe, expect, it } from 'vitest';
import { json, mockApi, requestBody } from '../test/mockApi';
import { ApiError, apiRequest, login, logout, me, register, wsUrl } from '.';

describe('apiRequest', () => {
  it('nutzt relative URL, same-origin-Credentials und JSON', async () => {
    const fetchMock = mockApi({ 'POST /api/login': json(200, { user: { id: 1, username: 'a_b', isAdmin: false } }) });
    await expect(login({ username: 'a_b', password: 'geheim123' })).resolves.toEqual({
      id: 1,
      username: 'a_b',
      isAdmin: false,
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/login');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(requestBody(init)).toEqual({ username: 'a_b', password: 'geheim123' });
  });

  it('macht aus { error, message } einen typisierten ApiError', async () => {
    mockApi({
      'POST /api/register': json(409, { error: 'username_taken', message: 'Benutzername ist bereits vergeben' }),
    });
    const err = await register({ username: 'abc', password: '12345678' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'username_taken', message: 'Benutzername ist bereits vergeben' });
  });

  it('meldet Antworten ohne Fehler-Body als unknown', async () => {
    mockApi({ 'GET /api/me': json(502) });
    await expect(me()).rejects.toMatchObject({ status: 502, code: 'unknown' });
  });

  it('meldet nicht erreichbaren Server als network', async () => {
    mockApi({ 'GET /api/me': new TypeError('Failed to fetch') });
    await expect(me()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('logout akzeptiert 204 ohne Body', async () => {
    mockApi({ 'POST /api/logout': json(204) });
    await expect(logout()).resolves.toBeUndefined();
  });

  it('lehnt absolute URLs ab (D-014)', async () => {
    await expect(apiRequest('http://spiel.example/api/me')).rejects.toThrow(/relativen Pfad/);
    await expect(apiRequest('//evil.example/api')).rejects.toThrow(/relativen Pfad/);
  });
});

describe('wsUrl', () => {
  it('http → ws mit gleichem Host und Port', () => {
    expect(wsUrl('/ws', { protocol: 'http:', host: 'spiel.example:8080' })).toBe('ws://spiel.example:8080/ws');
  });

  it('https → wss', () => {
    expect(wsUrl('/ws', { protocol: 'https:', host: 'poker.example.org' })).toBe('wss://poker.example.org/ws');
  });

  it('nimmt standardmäßig window.location', () => {
    expect(wsUrl('/ws')).toBe(`ws://${window.location.host}/ws`);
  });

  it('lehnt absolute Pfade ab', () => {
    expect(() => wsUrl('ws://x/ws', { protocol: 'http:', host: 'x' })).toThrow(/relativen Pfad/);
  });
});
