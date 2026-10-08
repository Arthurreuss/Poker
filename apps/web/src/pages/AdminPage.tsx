// Admin-Bereich /admin/* (nur Admins, RequireAdmin in App.tsx). Unterseiten: /admin/feedback (WP-024).
import { Link, Route, Routes } from 'react-router';
import { AdminFeedbackPage } from './AdminFeedbackPage';
import adminStyles from './Admin.module.css';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

function AdminHome() {
  return (
    <ul className={adminStyles.links}>
      <li>
        <Link to="feedback">Feedback</Link>
      </li>
    </ul>
  );
}

export function AdminPage() {
  return (
    <PlaceholderPage title="Admin">
      <Routes>
        <Route index element={<AdminHome />} />
        <Route path="feedback" element={<AdminFeedbackPage />} />
        <Route path="*" element={<p className={styles.muted}>Diese Admin-Seite gibt es nicht.</p>} />
      </Routes>
    </PlaceholderPage>
  );
}
