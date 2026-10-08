import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { REACTIONS_STORAGE_KEY, useReactionsPreference } from './reactions';

describe('useReactionsPreference (WP-032)', () => {
  it('Standard ist an', () => {
    expect(renderHook(() => useReactionsPreference()).result.current[0]).toBe(true);
  });

  it('speichert in localStorage und benachrichtigt alle Nutzer', () => {
    const a = renderHook(() => useReactionsPreference());
    const b = renderHook(() => useReactionsPreference());
    act(() => {
      a.result.current[1](false);
    });
    expect(window.localStorage.getItem(REACTIONS_STORAGE_KEY)).toBe('off');
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);
    act(() => {
      a.result.current[1](true);
    });
    expect(window.localStorage.getItem(REACTIONS_STORAGE_KEY)).toBe('on');
  });

  it('funktioniert ohne localStorage (wirft) im Speicher weiter', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useReactionsPreference());
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });

  it('übernimmt Änderungen aus anderen Tabs (storage-Event)', () => {
    const { result } = renderHook(() => useReactionsPreference());
    act(() => {
      window.localStorage.setItem(REACTIONS_STORAGE_KEY, 'off');
      window.dispatchEvent(new StorageEvent('storage', { key: REACTIONS_STORAGE_KEY }));
    });
    expect(result.current[0]).toBe(false);
  });
});
