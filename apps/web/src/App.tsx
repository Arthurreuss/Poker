import { useEffect, useState } from 'react';
import { appTitle, fetchHealth, healthLabel, type HealthState } from './health';

export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    void fetchHealth().then(setHealth);
  }, []);

  return (
    <main>
      <h1>{appTitle(import.meta.env.MODE)}</h1>
      <p data-health={health.kind}>{healthLabel(health)}</p>
    </main>
  );
}
