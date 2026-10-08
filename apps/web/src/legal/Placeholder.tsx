// Platzhalter in den Rechtstexten (WP-022): sichtbar markiert, bis Arthur die echten Angaben einträgt.
import type { ReactNode } from 'react';
import styles from './LegalPage.module.css';

/** Markierter Platzhalter, z. B. `<Placeholder>Vorname Nachname</Placeholder>` → „[Vorname Nachname]“. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark className={styles.placeholder} data-placeholder="">
      [{children}]
    </mark>
  );
}
