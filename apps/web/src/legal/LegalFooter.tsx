// Fußzeile mit Spielgeld-Hinweis (D-001) und Links auf Impressum und Datenschutz (WP-022).
// Auf allen Seiten: App-Shell, Login/Registrierung, Rechtstexte. Am Tisch über das Tisch-Menü.
import { Link } from 'react-router';
import { cx } from '../styles/cx';
import styles from './LegalFooter.module.css';

export const IMPRESSUM_PATH = '/impressum';
export const DATENSCHUTZ_PATH = '/datenschutz';

export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cx(styles.footer, className)}>
      <span>Spielgeld – kein Echtgeld</span>
      <nav aria-label="Rechtliches" className={styles.links}>
        <Link to={IMPRESSUM_PATH}>Impressum</Link>
        <Link to={DATENSCHUTZ_PATH}>Datenschutz</Link>
      </nav>
    </footer>
  );
}
