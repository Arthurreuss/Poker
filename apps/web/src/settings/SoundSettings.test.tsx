// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { readSoundPreference, writeSoundPreference } from './sound';
import { SoundSettings } from './SoundSettings';

afterEach(() => {
  writeSoundPreference({ enabled: true, volume: 0.7 });
  window.localStorage.clear();
});

describe('SoundSettings', () => {
  it('Ton standardmäßig an, abschaltbar, bleibt gespeichert', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SoundSettings />);
    const toggle = screen.getByRole('checkbox', { name: /Ton/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('slider', { name: 'Lautstärke' })).toBeDisabled();
    expect(readSoundPreference().enabled).toBe(false);
    unmount();
    render(<SoundSettings />);
    expect(screen.getByRole('checkbox', { name: /Ton/ })).not.toBeChecked();
  });
});
