// Rahmen für alle eingeloggten Seiten außer dem Tisch: Kopfzeile mit App-Name, Menü, Feedback-Slot;
// Fußzeile mit Spielgeld-Hinweis und Rechtstexten (WP-022).
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { FeedbackSlot } from '../feedback/FeedbackSlot';
import { appTitle } from '../health';
import { LegalFooter } from '../legal/LegalFooter';
import { cx } from '../styles/cx';
import styles from './AppShell.module.css';

function navClass({ isActive }: { isActive: boolean }): string {
  return cx(styles.link, isActive && styles.active);
}

export function AppShell() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => {
    setMenuOpen(false);
  };

  const onLogout = async () => {
    close();
    // RequireAuth leitet danach auf /login (ohne Rücksprungziel).
    await logout();
  };

  return (
    <div className={cx(styles.shell, 'safe-area')}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} onClick={close}>
          <img src="/icons/icon.svg" alt="" width={28} height={28} />
          <span>{appTitle(import.meta.env.MODE)}</span>
        </Link>
        <div className={styles.headerEnd}>
          <FeedbackSlot />
          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="main-menu"
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            Menü
          </button>
        </div>
        <nav id="main-menu" aria-label="Hauptmenü" className={styles.nav} data-open={menuOpen}>
          <NavLink to="/" end className={navClass} onClick={close}>
            Lobby
          </NavLink>
          <NavLink to="/leaderboard" className={navClass} onClick={close}>
            Rangliste
          </NavLink>
          <NavLink to="/settings" className={navClass} onClick={close}>
            Einstellungen
          </NavLink>
          {user?.isAdmin === true && (
            <NavLink to="/admin" className={navClass} onClick={close}>
              Admin
            </NavLink>
          )}
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              void onLogout();
            }}
          >
            Abmelden{user === null ? '' : ` (${user.username})`}
          </button>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
      <LegalFooter />
    </div>
  );
}
