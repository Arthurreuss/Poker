// Admin-Dashboard /admin/* (WP-029, nur Admins: RequireAdmin in App.tsx, echte Prüfung im Server-Guard D-029).
// Unterseiten: Übersicht (Index), Spieler, Tische, Feedback (WP-024), Protokoll. Bausteine: src/admin/.
import { NavLink, Route, Routes } from 'react-router';
import { AuditPanel } from '../admin/AuditPanel';
import dashboard from '../admin/Dashboard.module.css';
import { OverviewPanel } from '../admin/OverviewPanel';
import { PlayersPanel } from '../admin/PlayersPanel';
import { TablesPanel } from '../admin/TablesPanel';
import { AdminFeedbackPage } from './AdminFeedbackPage';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

const SECTIONS = [
  { to: '', label: 'Übersicht' },
  { to: 'players', label: 'Spieler' },
  { to: 'tables', label: 'Tische' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'audit', label: 'Protokoll' },
] as const;

export function AdminPage() {
  return (
    <PlaceholderPage title="Admin">
      <nav aria-label="Admin-Bereiche" className={dashboard.nav}>
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to === '' ? '/admin' : `/admin/${s.to}`} end className={dashboard.navLink ?? ''}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<OverviewPanel />} />
        <Route path="players" element={<PlayersPanel />} />
        <Route path="tables" element={<TablesPanel />} />
        <Route path="feedback" element={<AdminFeedbackPage />} />
        <Route path="audit" element={<AuditPanel />} />
        <Route path="*" element={<p className={styles.muted}>Diese Admin-Seite gibt es nicht.</p>} />
      </Routes>
    </PlaceholderPage>
  );
}
