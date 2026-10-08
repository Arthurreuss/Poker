import { describe, expect, it } from 'vitest';
import { readTurnClock, turnClockDisplay, type TurnClock } from './turnClock';
import { NOW, serverView, startGame, toAct } from './test/fixtures';

describe('readTurnClock', () => {
  const game = startGame();
  const hand = serverView(game, 1).round?.hand;
  if (hand === null || hand === undefined) throw new Error('keine Hand');
  const clock = {
    playerId: String(toAct(game)),
    seat: toAct(game) - 1,
    handNumber: hand.handNumber,
    actionSeq: hand.actionSeq,
    startedAtMs: NOW,
    turnEndsAtMs: NOW + 20_000,
    deadlineMs: NOW + 80_000,
  };

  it('rechnet Server-Zeitpunkte auf die lokale Uhr um', () => {
    // Server-Uhr geht 3 s vor: Empfang lokal bei NOW − 3000
    const view = serverView(game, 1, { turnClock: clock, serverNowMs: NOW });
    expect(readTurnClock(view, NOW - 3_000)).toEqual({
      seat: clock.seat,
      startedMs: NOW - 3_000,
      turnEndsMs: NOW + 17_000,
      deadlineMs: NOW + 77_000,
    });
  });

  it('ignoriert eine Uhr, die nicht zur aktuellen Aktion gehört', () => {
    expect(
      readTurnClock(serverView(game, 1, { turnClock: { ...clock, actionSeq: clock.actionSeq + 1 } }), NOW),
    ).toBeNull();
    expect(readTurnClock(serverView(game, 1, { turnClock: null }), NOW)).toBeNull();
  });
});

describe('turnClockDisplay', () => {
  const clock: TurnClock = { seat: 0, startedMs: 0, turnEndsMs: 20_000, deadlineMs: 80_000 };

  it('normale Zugzeit: Anteil läuft von 1 auf 0, keine Zeitbank-Anzeige', () => {
    expect(turnClockDisplay(clock, 0)).toEqual({ fraction: 1, timeBankSeconds: undefined });
    expect(turnClockDisplay(clock, 15_000)).toEqual({ fraction: 0.25, timeBankSeconds: undefined });
  });

  it('danach Zeitbank: Ring neu gefüllt, Sekunden aufgerundet', () => {
    expect(turnClockDisplay(clock, 20_000)).toEqual({ fraction: 1, timeBankSeconds: 60 });
    expect(turnClockDisplay(clock, 50_500)).toEqual({ fraction: 29_500 / 60_000, timeBankSeconds: 30 });
    expect(turnClockDisplay(clock, 90_000)).toEqual({ fraction: 0, timeBankSeconds: 0 });
  });

  it('ohne Zeitbank (leer oder getrennt): Ring endet an der Deadline', () => {
    const grace: TurnClock = { seat: 0, startedMs: 0, turnEndsMs: 20_000, deadlineMs: 3_000 };
    expect(turnClockDisplay(grace, 1_500).fraction).toBeCloseTo(1_500 / 20_000);
    expect(turnClockDisplay(grace, 5_000)).toEqual({ fraction: 0, timeBankSeconds: undefined });
  });
});
