import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ORIENTATION_STORAGE_KEY, useOrientationPreference } from './orientation';

describe('useOrientationPreference', () => {
  it('Standard ist auto', () => {
    const { result } = renderHook(() => useOrientationPreference());
    expect(result.current[0]).toBe('auto');
  });

  it('speichert in localStorage und benachrichtigt alle Nutzer', () => {
    const a = renderHook(() => useOrientationPreference());
    const b = renderHook(() => useOrientationPreference());
    act(() => {
      a.result.current[1]('landscape');
    });
    expect(window.localStorage.getItem(ORIENTATION_STORAGE_KEY)).toBe('landscape');
    expect(a.result.current[0]).toBe('landscape');
    expect(b.result.current[0]).toBe('landscape');
  });

  it('liest gespeicherten Wert, ungültige Werte → auto', () => {
    window.localStorage.setItem(ORIENTATION_STORAGE_KEY, 'portrait');
    expect(renderHook(() => useOrientationPreference()).result.current[0]).toBe('portrait');
    window.localStorage.setItem(ORIENTATION_STORAGE_KEY, 'schief');
    expect(renderHook(() => useOrientationPreference()).result.current[0]).toBe('auto');
  });

  it('funktioniert ohne localStorage (wirft) im Speicher weiter', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const { result } = renderHook(() => useOrientationPreference());
    act(() => {
      result.current[1]('portrait');
    });
    expect(result.current[0]).toBe('portrait');
    // Zurücksetzen für andere Tests (Speicherwert ist modulweit).
    act(() => {
      result.current[1]('auto');
    });
  });

  it('übernimmt Änderungen aus anderen Tabs (storage-Event)', () => {
    const { result } = renderHook(() => useOrientationPreference());
    act(() => {
      window.localStorage.setItem(ORIENTATION_STORAGE_KEY, 'landscape');
      window.dispatchEvent(new StorageEvent('storage', { key: ORIENTATION_STORAGE_KEY }));
    });
    expect(result.current[0]).toBe('landscape');
  });
});
