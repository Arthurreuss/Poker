import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchHealth, healthLabel, type HealthState } from '../health';
import styles from './Page.module.css';
import { PlaceholderPage } from './PlaceholderPage';

/** Platzhalter bis WP-015 (Tischliste, Tisch erstellen). */
export function LobbyPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    void fetchHealth().then(setHealth);
  }, []);

  return (
    <PlaceholderPage title="Lobby">
      <p>Hallo {user?.username}! Hier erscheinen bald die offenen Tische.</p>
      <p className={styles.muted} data-health={health.kind}>
        {healthLabel(health)}
      </p>
    </PlaceholderPage>
  );
}
