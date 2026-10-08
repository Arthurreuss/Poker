import { describe, expect, it, vi } from 'vitest';
import { copyInvite, invitePath, inviteUrl, shareInvite } from './invite';

const nav = (patch: object) => patch as unknown as Navigator;

describe('Einladungslink', () => {
  it('Pfad und URL unter derselben Origin (D-014)', () => {
    expect(invitePath('ab_C-1')).toBe('/join/ab_C-1');
    expect(inviteUrl('ab_C-1', 'https://poker.example')).toBe('https://poker.example/join/ab_C-1');
  });

  it('teilt über die Web Share API', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await shareInvite('https://x/join/a', 'Freitag', nav({ share }))).toBe('shared');
    expect(share).toHaveBeenCalledWith({
      title: 'Einladung zum Pokertisch',
      text: 'Komm an meinen Tisch „Freitag“',
      url: 'https://x/join/a',
    });
  });

  it('Abbruch im Teilen-Menü kopiert nicht', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const share = vi.fn(() => Promise.reject(new DOMException('abgebrochen', 'AbortError')));
    expect(await shareInvite('u', 't', nav({ share, clipboard: { writeText } }))).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('ohne Web Share API oder bei Fehler: kopieren; ohne Zwischenablage: von Hand', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await shareInvite('u', 't', nav({ clipboard: { writeText } }))).toBe('copied');
    const share = vi.fn(() => Promise.reject(new Error('nicht erlaubt')));
    expect(await shareInvite('u', 't', nav({ share, clipboard: { writeText } }))).toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(await copyInvite('u', nav({}))).toBe('manual');
    const failing = vi.fn(() => Promise.reject(new Error('verweigert')));
    expect(await copyInvite('u', nav({ clipboard: { writeText: failing } }))).toBe('manual');
  });
});
