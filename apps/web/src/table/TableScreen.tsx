import type { ReactNode } from 'react';
import { useOrientationPreference, type OrientationPreference } from '../settings/orientation';
import { PokerTable, type PokerTableProps } from './PokerTable';
import { TableMenu } from './TableMenu';
import { useTableLayout } from './useTableLayout';

export interface TableScreenProps extends Omit<PokerTableProps, 'layout' | 'menu'> {
  /** Weitere Einträge im Tisch-Menü (WP-018). */
  readonly menuItems?: ReactNode;
  /**
   * Gesteuerte Präferenz (nur Testseite). Ohne Angabe gilt die gespeicherte Einstellung
   * (`useOrientationPreference`, dieselbe wie auf der Einstellungsseite).
   */
  readonly preference?: OrientationPreference;
  readonly onPreferenceChange?: (value: OrientationPreference) => void;
}

/**
 * Tischansicht mit Ausrichtungs-Umschalter (WP-017, D-009): wählt das Layout aus Präferenz und
 * Viewport und zeigt das Tisch-Menü. Ein Layoutwechsel rendert denselben `PokerTable` mit anderer
 * `layout`-Prop – kein Neu-Mounten, kein Zustandsverlust.
 */
export function TableScreen({ menuItems, preference, onPreferenceChange, ...tableProps }: TableScreenProps) {
  const [stored, setStored] = useOrientationPreference();
  const current = preference ?? stored;
  const layout = useTableLayout(current);
  return (
    <PokerTable
      {...tableProps}
      layout={layout}
      menu={
        <TableMenu preference={current} onPreferenceChange={onPreferenceChange ?? setStored}>
          {menuItems}
        </TableMenu>
      }
    />
  );
}
