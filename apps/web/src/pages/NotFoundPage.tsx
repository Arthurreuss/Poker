import { Link } from 'react-router';
import { PlaceholderPage } from './PlaceholderPage';

export function NotFoundPage() {
  return (
    <PlaceholderPage title="Seite nicht gefunden">
      <Link to="/">Zur Lobby</Link>
    </PlaceholderPage>
  );
}
