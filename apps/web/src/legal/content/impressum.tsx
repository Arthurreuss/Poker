// Impressum (WP-022). Angaben von Arthur (2026-10-08); Änderungen nur in dieser Datei.
// Bewusst ohne Telefonnummer und USt-ID: privates, nicht kommerzielles Angebot.
// Für neue offene Angaben: <Placeholder>…</Placeholder> (gelb markiert).
import { Link } from 'react-router';
import { DATENSCHUTZ_PATH } from '../LegalFooter';

export const PROVIDER = {
  name: 'Arthur Reuss',
  street: 'Kastanienallee 33',
  city: '14050 Berlin',
  email: 'poker@arthur-reuss.de',
} as const;

export function ImpressumContent() {
  return (
    <>
      <h2>Angaben gemäß § 5 DDG</h2>
      <p>
        {PROVIDER.name}
        <br />
        {PROVIDER.street}
        <br />
        {PROVIDER.city}
        <br />
        Deutschland
      </p>

      <h2>Kontakt</h2>
      <p>
        E-Mail: <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>
      </p>

      <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
      <p>
        {PROVIDER.name}, {PROVIDER.street}, {PROVIDER.city}
      </p>

      <h2>Hinweis</h2>
      <p>
        Dieses Angebot ist ein privates, nicht kommerzielles Hobbyprojekt. Gespielt wird ausschließlich mit Spielgeld:
        Chips haben keinen Geldwert, sie können weder gekauft noch ausgezahlt oder gegen Geld getauscht werden. Es
        findet kein Glücksspiel um Geld statt.
      </p>
      <p>
        Informationen zum Umgang mit deinen Daten: <Link to={DATENSCHUTZ_PATH}>Datenschutzerklärung</Link>.
      </p>
    </>
  );
}
