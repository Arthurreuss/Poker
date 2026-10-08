// Rangliste, Profil und Hand-Historie (WP-019) – Seiten mit gemockter API.
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { HandDetail, LeaderboardEntry, PlayerStats, RoundSummary } from '../api/stats';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { PLAYER, json, mockApi } from '../test/mockApi';
import { actionLabel, formatNet, formatRate, placementLabel, playerName } from './format';

function renderApp(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const ME = { 'GET /api/me': json(200, { user: PLAYER }) };

const BOARD: LeaderboardEntry[] = [
  { rank: 1, userId: 7, name: 'anna', avatar: 'owl', points: 12, rounds: 4, wins: 2 },
  { rank: 1, userId: PLAYER.id, name: PLAYER.username, avatar: 'fox', points: 12, rounds: 5, wins: 1 },
  { rank: 3, userId: 9, name: 'cleo', avatar: null, points: 3, rounds: 4, wins: 0 },
];

describe('format', () => {
  it('Quoten, Gewinn, Namen, Plätze, Aktionen', () => {
    expect(formatRate({ count: 1, of: 3 })).toBe('33 %');
    expect(formatRate({ count: 0, of: 0 })).toBe('–');
    expect(formatNet(1200)).toBe('+1.200');
    expect(formatNet(-40)).toBe('−40');
    expect(formatNet(0)).toBe('±0');
    expect(playerName(null)).toBe('Gelöschter Spieler');
    const players = [
      { name: 'a', seat: 0, placement: 1, points: 4, isViewer: false },
      { name: 'b', seat: 1, placement: 3, points: 0, isViewer: false },
      { name: null, seat: 2, placement: 3, points: 0, isViewer: false },
    ];
    expect(placementLabel(players[0] as RoundSummary['players'][number], players)).toBe('1.');
    expect(placementLabel(players[1] as RoundSummary['players'][number], players)).toBe('3. (geteilt)');
    expect(actionLabel({ action: 'raise', amount: 60, streetTotal: 80, isAllIn: false })).toBe('erhöht auf 80');
    expect(actionLabel({ action: 'call', amount: 40, streetTotal: 60, isAllIn: true })).toBe('callt 40 (All-in)');
  });
});

describe('Rangliste', () => {
  it('zeigt Punkte, Runden, Siege, geteilte Plätze und hebt den eigenen Eintrag hervor', async () => {
    mockApi({ ...ME, 'GET /api/leaderboard': json(200, { players: BOARD }) });
    renderApp('/leaderboard');
    const rows = await screen.findAllByRole('row');
    expect(rows.slice(1).map((r) => r.textContent)).toEqual([
      '1.anna1242',
      `1.${PLAYER.username} (du)1251`,
      '3.Ccleo340', // ohne Avatar: Anfangsbuchstabe (WP-032)
    ]);
    expect(rows.slice(1).map((r) => within(r).getByTestId('avatar').dataset['avatar'])).toEqual(['owl', 'fox', 'none']);
    const own = rows[2];
    expect(own).toHaveAttribute('aria-current', 'true');
    expect(within(own as HTMLElement).getByText('1.')).toHaveAttribute('title', 'geteilter Platz');
    expect(screen.getByRole('link', { name: 'anna' })).toHaveAttribute('href', '/players/anna');
  });

  it('zeigt keine Spieler ohne beendete Runde (D-024)', async () => {
    mockApi({
      ...ME,
      'GET /api/leaderboard': json(200, {
        players: [...BOARD, { rank: 4, userId: 11, name: 'neu', avatar: null, points: 0, rounds: 0, wins: 0 }],
      }),
    });
    renderApp('/leaderboard');
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(BOARD.length + 1);
    expect(screen.queryByText('neu')).toBeNull();
  });

  it('ohne beendete Runden: Hinweis statt leerer Tabelle', async () => {
    mockApi({
      ...ME,
      'GET /api/leaderboard': json(200, {
        players: [{ rank: 1, userId: 11, name: 'neu', points: 0, rounds: 0, wins: 0 }],
      }),
    });
    renderApp('/leaderboard');
    expect(await screen.findByText('Noch keine beendeten Runden.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('lädt neu, wenn die App wieder in den Vordergrund kommt (z. B. nach Rundenende)', async () => {
    let calls = 0;
    mockApi({
      ...ME,
      'GET /api/leaderboard': () => {
        calls++;
        return json(200, { players: calls === 1 ? BOARD : [{ ...BOARD[0], points: 15 }] });
      },
    });
    renderApp('/leaderboard');
    await screen.findByText('anna');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText('15');
    expect(calls).toBe(2);
  });

  it('zeigt Fehler des Servers', async () => {
    mockApi({ ...ME, 'GET /api/leaderboard': json(500, { error: 'internal', message: 'Interner Fehler' }) });
    renderApp('/leaderboard');
    expect(await screen.findByRole('alert')).toHaveTextContent('Interner Fehler');
  });
});

const ROUND: RoundSummary = {
  id: 31,
  tableName: 'Freitag',
  status: 'finished',
  startedAt: '2026-10-08T18:00:00Z',
  finishedAt: '2026-10-08T19:00:00Z',
  handCount: 12,
  viewerParticipated: true,
  isPublic: true,
  players: [
    { name: 'anna', seat: 0, placement: 1, points: 4, isViewer: false },
    { name: PLAYER.username, seat: 1, placement: 2, points: 2, isViewer: true },
    { name: null, seat: 2, placement: 3, points: 0, isViewer: false },
    { name: 'cleo', seat: 3, placement: 3, points: 0, isViewer: false },
  ],
};

describe('Profil', () => {
  it('eigenes Profil: Kennzahlen und letzte Runden mit Link zur Runde', async () => {
    const stats: PlayerStats = {
      player: { id: PLAYER.id, name: PLAYER.username, avatar: 'rocket' },
      rank: 2,
      points: 12,
      rounds: 5,
      wins: 1,
      hands: {
        hands: 140,
        vpip: { count: 30, of: 120 },
        pfr: { count: 12, of: 120 },
        wtsd: { count: 0, of: 0 },
        wsd: { count: 0, of: 0 },
      },
    };
    mockApi({
      ...ME,
      [`GET /api/players/${PLAYER.username}/stats`]: json(200, stats),
      'GET /api/rounds/recent': json(200, { rounds: [ROUND, { ...ROUND, id: 32, status: 'aborted' }] }),
    });
    renderApp(`/players/${PLAYER.username}`);
    await screen.findByRole('heading', { level: 1, name: 'Meine Statistiken' });
    expect(await screen.findByText('25 %')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: `${PLAYER.username}: Rakete` })).toBeInTheDocument();
    expect(screen.getByText('10 %')).toBeInTheDocument();
    expect(screen.getAllByText('–')).toHaveLength(2);
    const links = await screen.findAllByRole('link', { name: /Freitag/ });
    expect(links[0]).toHaveAttribute('href', '/rounds/31');
    expect(links[0]).toHaveTextContent('Du: Platz 2. · 2 Punkte');
    expect(links[1]).toHaveTextContent('abgebrochen, ohne Punkte');
  });

  it('fremdes Profil: öffentliche Runden ohne eigene Teilnahme mit Link; unbekannter Spieler → Fehler', async () => {
    mockApi({
      ...ME,
      'GET /api/players/anna/stats': json(404, { error: 'not_found', message: 'Spieler nicht gefunden' }),
      'GET /api/rounds/recent?player=anna': json(200, { rounds: [{ ...ROUND, viewerParticipated: false }] }),
    });
    renderApp('/players/anna');
    await screen.findByRole('heading', { level: 1, name: 'Spieler anna' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Spieler nicht gefunden');
    expect(await screen.findByRole('link', { name: /Freitag/ })).toHaveAttribute('href', '/rounds/31');
    expect(screen.getByText('anna: Platz 1. · 4 Punkte')).toBeInTheDocument();
  });

  it('Profil ohne beendete Runde: Platz „–“ (D-024)', async () => {
    const stats: PlayerStats = {
      player: { id: 11, name: 'neu', avatar: null },
      rank: null,
      points: 0,
      rounds: 0,
      wins: 0,
      hands: {
        hands: 0,
        vpip: { count: 0, of: 0 },
        pfr: { count: 0, of: 0 },
        wtsd: { count: 0, of: 0 },
        wsd: { count: 0, of: 0 },
      },
    };
    mockApi({
      ...ME,
      'GET /api/players/neu/stats': json(200, stats),
      'GET /api/rounds/recent?player=neu': json(200, { rounds: [] }),
    });
    renderApp('/players/neu');
    const tiles = await screen.findByRole('region', { name: 'Rangliste' });
    expect(tiles).toHaveTextContent('–Platz0Punkte0Runden');
  });
});

describe('Runde und Hand', () => {
  it('Runde: geteilte Plätze, gelöschter Spieler, Hände mit eigenen Karten', async () => {
    mockApi({
      ...ME,
      'GET /api/rounds/31': json(200, {
        round: ROUND,
        hands: [
          {
            id: 501,
            handNumber: 1,
            board: ['Ah', 'Kd', '2c'],
            winners: [{ seat: 2, name: null, amount: 60 }],
            viewer: { holeCards: ['Qs', 'Qh'], net: -20 },
          },
        ],
      }),
    });
    renderApp('/rounds/31');
    const result = await screen.findByRole('region', { name: 'Ergebnis' });
    expect(
      within(result)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '1. anna4 Punkte',
      `2. ${PLAYER.username}2 Punkte`,
      '3. (geteilt) Gelöschter Spieler0 Punkte',
      '3. (geteilt) cleo0 Punkte',
    ]);
    const hand = screen.getByRole('link', { name: /#1/ });
    expect(hand).toHaveAttribute('href', '/hands/501');
    expect(within(hand).getByRole('img', { name: 'Pik Dame' })).toBeInTheDocument();
    expect(hand).toHaveTextContent('Gelöschter Spieler +60');
    expect(hand).toHaveTextContent('−20');
  });

  it('Hand: fremde Karten verdeckt, gezeigte offen, Aktionen je Straße mit Automatik', async () => {
    const detail: HandDetail = {
      id: 501,
      roundId: 31,
      handNumber: 4,
      startedAt: '2026-10-08T18:10:00Z',
      smallBlind: 10,
      bigBlind: 20,
      buttonSeat: 0,
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      board: ['Ah', 'Kd', '2c', '7s', '9h'],
      showdown: true,
      players: [
        {
          seat: 0,
          name: 'anna',
          isViewer: false,
          startStack: 500,
          endStack: 620,
          folded: false,
          cards: 'shown',
          holeCards: ['As', 'Ad'],
          handDescription: 'Drilling, Asse',
        },
        {
          seat: 1,
          name: PLAYER.username,
          isViewer: true,
          startStack: 500,
          endStack: 380,
          folded: false,
          cards: 'mucked',
          holeCards: ['Qs', 'Qh'],
          handDescription: null,
        },
        {
          seat: 2,
          name: null,
          isViewer: false,
          startStack: 500,
          endStack: 500,
          folded: true,
          cards: 'hidden',
          holeCards: null,
          handDescription: null,
        },
      ],
      actions: [
        {
          seq: 1,
          street: 'preflop',
          seat: 1,
          name: PLAYER.username,
          action: 'small_blind',
          amount: 10,
          streetTotal: 10,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 2,
          street: 'preflop',
          seat: 2,
          name: null,
          action: 'big_blind',
          amount: 20,
          streetTotal: 20,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 3,
          street: 'preflop',
          seat: 0,
          name: 'anna',
          action: 'raise',
          amount: 60,
          streetTotal: 60,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 4,
          street: 'preflop',
          seat: 1,
          name: PLAYER.username,
          action: 'call',
          amount: 50,
          streetTotal: 60,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 5,
          street: 'preflop',
          seat: 2,
          name: null,
          action: 'fold',
          amount: 0,
          streetTotal: 20,
          isAllIn: false,
          isAutomatic: true,
        },
        {
          seq: 6,
          street: 'flop',
          seat: 1,
          name: PLAYER.username,
          action: 'check',
          amount: 0,
          streetTotal: 0,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 7,
          street: 'flop',
          seat: 0,
          name: 'anna',
          action: 'bet',
          amount: 60,
          streetTotal: 60,
          isAllIn: false,
          isAutomatic: false,
        },
        {
          seq: 8,
          street: 'flop',
          seat: 1,
          name: PLAYER.username,
          action: 'call',
          amount: 60,
          streetTotal: 60,
          isAllIn: false,
          isAutomatic: false,
        },
      ],
      pots: [{ amount: 260, winners: [{ seat: 0, name: 'anna', amount: 260 }], handDescription: 'Drilling, Asse' }],
      winners: [{ seat: 0, name: 'anna', amount: 260 }],
    };
    mockApi({ ...ME, 'GET /api/hands/501': json(200, { hand: detail }) });
    renderApp('/hands/501');
    await screen.findByRole('heading', { level: 1, name: 'Hand #4' });
    const seat = (n: number) => document.querySelector(`[data-seat="${String(n)}"]`) as HTMLElement;
    expect(within(seat(0)).getByRole('img', { name: 'Pik Ass' })).toBeInTheDocument();
    expect(seat(0)).toHaveTextContent('Drilling, Asse');
    expect(within(seat(1)).getByRole('img', { name: 'Herz Dame' })).toBeInTheDocument();
    expect(seat(1)).toHaveTextContent('nicht gezeigt');
    expect(within(seat(2)).getAllByRole('img', { name: 'verdeckte Karte' })).toHaveLength(2);
    expect(seat(2)).toHaveTextContent('Gelöschter Spieler');
    const preflop = screen.getByRole('region', { name: 'Preflop' });
    expect(within(preflop).getByText('anna erhöht auf 60')).toBeInTheDocument();
    expect(within(preflop).getByText(/Gelöschter Spieler foldet \(automatisch\)/)).toBeInTheDocument();
    const flop = screen.getByRole('region', { name: 'Flop' });
    expect(
      within(flop)
        .getAllByRole('img')
        .map((i) => i.getAttribute('aria-label')),
    ).toEqual(['Herz Ass', 'Karo König', 'Kreuz 2']);
    // Turn und River ohne Aktionen (Check-Check gab es hier nicht) – Board trotzdem sichtbar.
    expect(screen.getByRole('region', { name: 'River' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Ergebnis' })).toHaveTextContent('anna +260');
    });
  });

  it('öffentliche Runde ohne Teilnahme: Ergebnis ja, Hände nein (D-024)', async () => {
    mockApi({
      ...ME,
      'GET /api/rounds/31': json(200, { round: { ...ROUND, viewerParticipated: false }, hands: null }),
    });
    renderApp('/rounds/31');
    const result = await screen.findByRole('region', { name: 'Ergebnis' });
    expect(within(result).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Die Hände sehen nur die Teilnehmer der Runde.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /#/ })).toBeNull();
  });

  it('private Runde ohne Teilnahme: Hinweis des Servers', async () => {
    mockApi({
      ...ME,
      'GET /api/rounds/40': json(403, {
        error: 'forbidden',
        message: 'Das Ergebnis eines privaten Tisches sehen nur seine Teilnehmer',
      }),
    });
    renderApp('/rounds/40');
    expect(await screen.findByRole('alert')).toHaveTextContent('nur seine Teilnehmer');
  });
});
