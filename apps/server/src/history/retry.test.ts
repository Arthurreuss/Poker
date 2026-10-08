// Retry und Hook-Kombination der Hand-Historie (WP-013), ohne DB.
import { describe, expect, it } from 'vitest';
import { InMemoryTableRepository } from '../game/repository';
import { combineHooks } from './hooks';
import { isRetryable, withFinishRoundRetry, withRetry } from './retry';

function recorder() {
  const warnings: object[] = [];
  const sleeps: number[] = [];
  return {
    warnings,
    sleeps,
    options: {
      delaysMs: [10, 20, 30],
      log: { error: () => undefined, warn: (obj: object) => warnings.push(obj) },
      sleep: (ms: number) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
  };
}

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

describe('isRetryable', () => {
  it('wiederholt Verbindungs- und Serverfehler, aber keine deterministischen SQL-Fehler', () => {
    expect(isRetryable(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isRetryable(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isRetryable(pgError('57P01'))).toBe(true); // admin_shutdown
    expect(isRetryable(pgError('40P01'))).toBe(true); // deadlock
    expect(isRetryable(pgError('23505'))).toBe(false); // unique_violation
    expect(isRetryable(pgError('23503'))).toBe(false); // foreign_key_violation
    expect(isRetryable(pgError('22P02'))).toBe(false); // invalid_text_representation
    expect(isRetryable(pgError('42703'))).toBe(false); // undefined_column
  });
});

describe('withRetry', () => {
  it('wiederholt vorübergehende Fehler mit den konfigurierten Wartezeiten', async () => {
    const r = recorder();
    let calls = 0;
    const result = await withRetry(
      't',
      { roundId: 1 },
      () => {
        calls++;
        return calls < 3 ? Promise.reject(new Error('DB weg')) : Promise.resolve('ok');
      },
      r.options,
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(r.sleeps).toEqual([10, 20]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatchObject({ roundId: 1, task: 't', attempt: 1, retryInMs: 10 });
  });

  it('gibt nach dem letzten Versuch auf und wirft mit Ursache', async () => {
    const r = recorder();
    let calls = 0;
    const cause = new Error('DB weg');
    const failing = withRetry(
      'saveHand',
      {},
      () => {
        calls++;
        return Promise.reject(cause);
      },
      r.options,
    );
    await expect(failing).rejects.toThrow('saveHand fehlgeschlagen (4 Versuch(e))');
    await expect(failing).rejects.toMatchObject({ cause });
    expect(calls).toBe(4);
  });

  it('wiederholt Constraint-Verletzungen nicht', async () => {
    const r = recorder();
    let calls = 0;
    await expect(
      withRetry(
        't',
        {},
        () => {
          calls++;
          return Promise.reject(pgError('23503'));
        },
        r.options,
      ),
    ).rejects.toThrow('1 Versuch');
    expect(calls).toBe(1);
    expect(r.sleeps).toEqual([]);
  });
});

describe('withFinishRoundRetry', () => {
  it('wiederholt nur finishRound', async () => {
    const r = recorder();
    const inner = new InMemoryTableRepository();
    let failFinish = 1;
    const original = inner.finishRound.bind(inner);
    inner.finishRound = (...args) => (failFinish-- > 0 ? Promise.reject(new Error('weg')) : original(...args));
    const repo = withFinishRoundRetry(inner, r.options);
    const tableId = await repo.createTable({
      createdBy: 1,
      inviteCode: 'x',
      settings: {} as never,
    });
    const roundId = await repo.startRound(tableId, [
      { userId: 1, seat: 0 },
      { userId: 2, seat: 1 },
    ]);
    await repo.finishRound(tableId, roundId, [
      { userId: 1, placement: 1, points: 2 },
      { userId: 2, placement: 2, points: 0 },
    ]);
    expect(inner.rounds.get(roundId)?.status).toBe('finished');
    expect(r.sleeps).toEqual([10]);
  });

  it('wiederholt auch abortRound (verwaiste Runde, WP-015)', async () => {
    const r = recorder();
    const inner = new InMemoryTableRepository();
    let failAbort = 1;
    const original = inner.abortRound.bind(inner);
    inner.abortRound = (...args) => (failAbort-- > 0 ? Promise.reject(new Error('weg')) : original(...args));
    const repo = withFinishRoundRetry(inner, r.options);
    const tableId = await repo.createTable({ createdBy: 1, inviteCode: 'y', settings: {} as never });
    const roundId = await repo.startRound(tableId, [
      { userId: 1, seat: 0 },
      { userId: 2, seat: 1 },
    ]);
    await repo.abortRound(tableId, roundId);
    expect(inner.rounds.get(roundId)?.status).toBe('aborted');
    expect(inner.tables.get(tableId)?.status).toBe('closed');
    expect(r.sleeps).toEqual([10]);
  });
});

describe('combineHooks', () => {
  it('ruft alle Hook-Sätze nacheinander auf, auch wenn einer fehlschlägt, und meldet den Fehler', async () => {
    const calls: string[] = [];
    const hooks = combineHooks(
      {
        onHandStarted: () => {
          calls.push('a');
          throw new Error('a kaputt');
        },
      },
      {},
      {
        onHandStarted: async () => {
          await Promise.resolve();
          calls.push('b');
        },
      },
    );
    await expect(hooks.onHandStarted?.({} as never)).rejects.toThrow('a kaputt');
    expect(calls).toEqual(['a', 'b']);
    await expect(hooks.onHandComplete?.({} as never)).resolves.toBeUndefined();
  });
});
