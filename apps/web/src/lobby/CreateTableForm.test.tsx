import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TableSettings } from '@poker/engine/protocol';
import { CreateTableForm } from './CreateTableForm';

function renderForm(onSubmit = vi.fn<(settings: TableSettings) => Promise<void>>(() => Promise.resolve())) {
  render(<CreateTableForm username="anna" onSubmit={onSubmit} />);
  return { onSubmit, user: userEvent.setup() };
}

const submit = () => screen.getByRole('button', { name: 'Tisch erstellen' });

async function replace(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  if (value !== '') await user.type(input, value);
}

describe('CreateTableForm', () => {
  it('zeigt die Defaults (1.500 Chips, 20 s, 60 s, steigend, öffentlich)', () => {
    renderForm();
    expect(screen.getByLabelText('Tischname')).toHaveValue('Tisch von anna');
    expect(screen.getByLabelText('Startstack')).toHaveValue('1500');
    expect(screen.getByLabelText('Zugzeit (Sekunden)')).toHaveValue('20');
    expect(screen.getByLabelText('Zeitbank (Sekunden)')).toHaveValue('60');
    expect(screen.getByLabelText('Minuten pro Level')).toHaveValue('10');
    expect(screen.getByLabelText('Steigend')).toBeChecked();
    expect(screen.getByLabelText('Öffentlich (in der Lobby)')).toBeChecked();
    expect(screen.getByLabelText('Start-Blinds')).toHaveDisplayValue('10/20');
    expect(screen.queryByText(/ante/i)).toHaveTextContent('keine Antes');
  });

  it('sendet gültige Einstellungen', async () => {
    const { onSubmit, user } = renderForm();
    await replace(user, 'Tischname', 'Freitagsrunde');
    await user.click(screen.getByLabelText('Privat (nur per Einladungslink)'));
    await user.click(screen.getByLabelText('Fest'));
    expect(screen.queryByLabelText('Minuten pro Level')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Plätze'), '6');
    await replace(user, 'Zugzeit (Sekunden)', '30');
    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Freitagsrunde',
      isPublic: false,
      maxSeats: 6,
      startingStack: 1500,
      blindStructure: { type: 'fixed', level: { smallBlind: 10, bigBlind: 20 } },
      turnTimeSeconds: 30,
      timeBankSeconds: 60,
    });
  });

  it('zeigt Fehler an den Feldern und sendet nichts', async () => {
    const { onSubmit, user } = renderForm();
    await replace(user, 'Tischname', '');
    await replace(user, 'Zugzeit (Sekunden)', '5');
    await replace(user, 'Zeitbank (Sekunden)', '301');
    await replace(user, 'Startstack', 'viel');
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Name fehlt')).toBeInTheDocument();
    expect(screen.getByText('Zugzeit: 10–120 Sekunden')).toBeInTheDocument();
    expect(screen.getByText('Zeitbank: 0–300 Sekunden')).toBeInTheDocument();
    expect(screen.getByText('Startstack muss eine ganze Zahl sein')).toBeInTheDocument();
    expect(screen.getByLabelText('Zugzeit (Sekunden)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Zugzeit (Sekunden)')).toHaveAccessibleDescription('Zugzeit: 10–120 Sekunden');

    // Korrigieren entfernt die Meldung des Feldes.
    await replace(user, 'Zugzeit (Sekunden)', '10');
    expect(screen.queryByText('Zugzeit: 10–120 Sekunden')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Zugzeit (Sekunden)')).toHaveAttribute('aria-invalid', 'false');
  });

  it('Big Blind größer als der Startstack wird abgelehnt', async () => {
    const { onSubmit, user } = renderForm();
    await replace(user, 'Startstack', '100');
    await user.selectOptions(screen.getByLabelText('Start-Blinds'), '100/200');
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Big Blind (200) darf nicht größer als der Startstack sein')).toBeInTheDocument();
  });

  it('zeigt Serverfehler', async () => {
    const { user } = renderForm(vi.fn(() => Promise.reject(new Error('Keine Verbindung zum Server'))));
    await user.click(submit());
    expect(await screen.findByRole('alert')).toHaveTextContent('Keine Verbindung zum Server');
  });
});
