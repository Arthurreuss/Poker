// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUND,
  parseSoundPreference,
  readSoundPreference,
  SOUND_STORAGE_KEY,
  writeSoundPreference,
} from './sound';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Ton-Einstellung', () => {
  it('Standard: Ton an', () => {
    expect(readSoundPreference()).toEqual(DEFAULT_SOUND);
    expect(DEFAULT_SOUND.enabled).toBe(true);
  });

  it('wird gespeichert und wieder gelesen', () => {
    writeSoundPreference({ enabled: false, volume: 0.3 });
    expect(JSON.parse(window.localStorage.getItem(SOUND_STORAGE_KEY) ?? '{}')).toMatchObject({
      enabled: false,
      volume: 0.3,
    });
    expect(readSoundPreference()).toMatchObject({ enabled: false, volume: 0.3, vibrate: true });
  });

  it('kaputte oder fremde Werte fallen auf den Standard zurück', () => {
    expect(parseSoundPreference('kaputt')).toEqual(DEFAULT_SOUND);
    expect(parseSoundPreference('{"enabled":"ja","volume":7}')).toEqual({ ...DEFAULT_SOUND, volume: 1 });
  });

  it('ohne localStorage (privater Modus) nur im Speicher', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blockiert');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blockiert');
    });
    writeSoundPreference({ enabled: false });
    expect(readSoundPreference().enabled).toBe(false);
    writeSoundPreference({ enabled: true });
  });
});
