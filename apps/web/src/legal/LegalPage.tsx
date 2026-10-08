// Seiten /impressum und /datenschutz (WP-022): ohne Login erreichbar, eigener schlichter Rahmen.
// Die Texte stehen in content/ (je eine Datei, leicht editierbar).
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../styles/cx';
import { DatenschutzContent } from './content/datenschutz';
import { ImpressumContent } from './content/impressum';
import { LegalFooter } from './LegalFooter';
import styles from './LegalPage.module.css';

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={cx(styles.shell, 'safe-area')}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <img src="/icons/icon.svg" alt="" width={28} height={28} />
          <span>Poker</span>
        </Link>
      </header>
      <main className={styles.main}>
        <article className={styles.article}>
          <h1>{title}</h1>
          {children}
        </article>
      </main>
      <LegalFooter />
    </div>
  );
}

export function ImpressumPage() {
  return (
    <LegalLayout title="Impressum">
      <ImpressumContent />
    </LegalLayout>
  );
}

export function DatenschutzPage() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <DatenschutzContent />
    </LegalLayout>
  );
}
