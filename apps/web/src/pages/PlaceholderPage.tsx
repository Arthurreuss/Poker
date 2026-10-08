import type { ReactNode } from 'react';
import styles from './Page.module.css';

/** Einfache Seite mit Überschrift – für Platzhalter, die spätere WPs füllen. */
export function PlaceholderPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </section>
  );
}
