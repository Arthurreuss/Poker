// Datenschutzerklärung (WP-022), von Arthur abgenommen; Speicherdauern nach D-025. Verantwortlicher: Angaben aus
// impressum.tsx (PROVIDER), Domains aus DOMAINS (D-023). Beschreibt die tatsächliche Datenverarbeitung der App.
// Ändert sich die Datenverarbeitung (neue Daten, neue Dienste, andere Speicherdauer), muss dieser Text im selben
// Commit angepasst werden – inkl. „Stand“. Keine Platzhalter (Test in legal.test.tsx).
// Technische Umsetzung der Fristen: Logs → docker/logrotate/rotate.sh, Feedback → apps/server/src/feedback/retention.ts,
// Admin-Protokoll → apps/server/src/admin/audit.ts.
import { Link } from 'react-router';
import { IMPRESSUM_PATH } from '../LegalFooter';
import { DOMAINS, PROVIDER } from './impressum';

export function DatenschutzContent() {
  return (
    <>
      <p>Stand: 8. Oktober 2026</p>
      <p>
        Diese Datenschutzerklärung gilt für die Web-App unter {DOMAINS.join(' und ')}. Beide Adressen führen zur selben
        Anwendung mit denselben Konten.
      </p>

      <h2>1. Verantwortlicher</h2>
      <p>
        {PROVIDER.name}, {PROVIDER.street}, {PROVIDER.city}
        <br />
        E-Mail: <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a> (siehe auch{' '}
        <Link to={IMPRESSUM_PATH}>Impressum</Link>)
      </p>

      <h2>2. Überblick</h2>
      <p>
        Poker ist ein privates, nicht kommerzielles Texas-Hold’em-Spiel für eine Freundesrunde. Gespielt wird nur mit
        Spielgeld. Wir verarbeiten nur die Daten, die für Konto, Spiel und Betrieb nötig sind. Es gibt keine Werbung,
        keine Tracking- oder Analyse-Dienste, keine Social-Media-Plugins und keine nachgeladenen Inhalte fremder
        Anbieter (Schriftarten, Skripte und Bilder kommen vom eigenen Server). Eine E-Mail-Adresse wird nicht abgefragt.
      </p>

      <h2>3. Hosting und Cloudflare</h2>
      <p>
        Die Anwendung läuft auf einem privaten Rechner des Verantwortlichen in Deutschland. Die Verbindung aus dem
        Internet läuft über Cloudflare (Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA). Cloudflare
        stellt die verschlüsselte Verbindung (HTTPS) bereit, leitet die Anfragen über einen Tunnel an den Rechner weiter
        und schützt vor Angriffen (Content Delivery Network). Dabei verarbeitet Cloudflare alle Anfragen an diese Seite,
        insbesondere IP-Adresse, Zeitpunkt, aufgerufene Adresse und technische Angaben des Browsers.
      </p>
      <p>
        Cloudflare ist als Auftragsverarbeiter tätig; mit Cloudflare besteht ein Vertrag zur Auftragsverarbeitung nach
        Art. 28 DSGVO (Data Processing Addendum von Cloudflare). Eine Übermittlung in die USA ist möglich; sie stützt
        sich auf die Zertifizierung von Cloudflare nach dem EU-U.S. Data Privacy Framework (Angemessenheitsbeschluss,
        Art. 45 DSGVO) und ergänzend auf Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO). Rechtsgrundlage ist
        unser berechtigtes Interesse an einem sicheren und erreichbaren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
      </p>

      <h2>4. Server-Logs</h2>
      <p>
        Bei jedem Aufruf protokollieren der Webserver und der Spielserver technische Daten: IP-Adresse, Datum und
        Uhrzeit, aufgerufene Adresse, Statuscode, übertragene Datenmenge, Antwortzeit, Referrer und Browser-Kennung
        (User-Agent) sowie Fehlermeldungen; bei manchen Vorgängen (z. B. Konto löschen) auch die interne Nummer des
        Kontos. Passwörter, Session-Cookies und Formularinhalte werden nicht protokolliert. Die Logs dienen der
        Fehlersuche und der Abwehr von Missbrauch (Art. 6 Abs. 1 lit. f DSGVO). Sie werden täglich rotiert und
        spätestens nach 14 Tagen automatisch gelöscht. Zum Schutz vor Passwort-Raten wird die IP-Adresse bei Anmeldung,
        Registrierung und Konto-Löschung zusätzlich kurzzeitig (eine Minute) im Arbeitsspeicher gezählt.
      </p>

      <h2>5. Konto</h2>
      <p>Für ein Konto speichern wir:</p>
      <ul>
        <li>den Benutzernamen (frei wählbar, gern ein Spitzname),</li>
        <li>
          das Passwort nur als Hash (Verfahren argon2id) – das Passwort selbst kennen wir nicht und können es nicht
          auslesen,
        </li>
        <li>Zeitpunkt der Registrierung und ob das Konto Administratorrechte hat,</li>
        <li>
          falls du einen gewählt hast: deinen Avatar (eines der fest vorgegebenen Bilder der App – eigene Bilder kann
          man nicht hochladen).
        </li>
      </ul>
      <p>
        Rechtsgrundlage ist die Bereitstellung des Spiels, das du mit der Registrierung nutzen möchtest (Art. 6 Abs. 1
        lit. b DSGVO). Die Daten bleiben gespeichert, bis du dein Konto löschst (Abschnitt 10).
      </p>
      <p>
        Bei Verstößen gegen die Spielregeln kann der Administrator ein Konto sperren; gespeichert wird dann der
        Zeitpunkt der Sperre. Alle Aktionen der Administratoren (z. B. Sperren, Passwort zurücksetzen, Tisch schließen,
        Abmelden erzwingen) werden in einem Admin-Protokoll festgehalten: welcher Administrator, welche Aktion, welches
        Konto bzw. welcher Tisch, wann und gegebenenfalls eine Begründung. Das dient der Nachvollziehbarkeit und der
        Abwehr von Missbrauch (Art. 6 Abs. 1 lit. f DSGVO). Einträge im Admin-Protokoll werden 1 Jahr nach dem Anlegen
        automatisch gelöscht.
      </p>

      <h2>6. Cookies und lokale Speicherung</h2>
      <p>
        Wir setzen genau ein Cookie: <code>poker_session</code> hält dich angemeldet. Es enthält eine zufällige Kennung,
        ist für Skripte nicht lesbar (HttpOnly), wird nur über HTTPS übertragen und läuft nach 30 Tagen oder beim
        Abmelden ab. Auf dem Server liegt nur ein Hash dieser Kennung. Das Cookie ist technisch notwendig (§ 25 Abs. 2
        Nr. 2 TDDDG); deshalb gibt es kein Cookie-Banner. Tracking- oder Werbe-Cookies verwenden wir nicht.
      </p>
      <p>
        Im Speicher deines Browsers legt die App außerdem deine Einstellungen zur Tisch-Ausrichtung und dazu, ob du
        Emoji-Reaktionen am Tisch sehen möchtest, ab (localStorage) und speichert die App-Dateien zwischen, damit sie
        schnell startet und als App installiert werden kann (Service Worker). Diese Daten verlassen dein Gerät nicht und
        lassen sich über die Browser-Einstellungen löschen.
      </p>

      <h2>7. Spieldaten, Rangliste und Statistiken</h2>
      <p>
        Wenn du spielst, speichern wir Tische (Name, Einstellungen, wer ihn erstellt hat), Runden, deine Teilnahme mit
        Sitzplatz, Platzierung und Punkten sowie die Hand-Historie: Karten, Einsätze und Aktionen jeder Hand (auch
        automatische Aktionen bei Zeitablauf oder Verbindungsabbruch). Daraus berechnen wir Rangliste und Statistiken.
      </p>
      <p>
        Für andere Spieler sichtbar sind dein Benutzername, dein Avatar, dein Spiel am Tisch, deine Punkte in der
        Rangliste, deine Statistiken und die Hand-Historie gemeinsamer Runden. Emoji-Reaktionen, die du am Tisch
        sendest, sehen alle an diesem Tisch kurz über deinem Platz; sie werden nicht gespeichert. Verdeckte Karten
        anderer Spieler werden nie angezeigt, nur im Showdown aufgedeckte. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b
        DSGVO. Während des Spiels besteht eine dauerhafte Verbindung (WebSocket) zum Server; dabei wird verarbeitet, ob
        du verbunden bist.
      </p>

      <h2>8. Feedback</h2>
      <p>
        Wenn du über die App Feedback schickst, speichern wir Kategorie, Text, Zeitpunkt, dein Konto und zur Einordnung
        technischen Kontext: aktuelle Seite bzw. Tisch, App-Version, Browser-Kennung (User-Agent) und
        Bildschirm-Ausrichtung. Lesen kann das nur der Administrator. Rechtsgrundlage ist unser berechtigtes Interesse,
        Fehler zu beheben und die App zu verbessern (Art. 6 Abs. 1 lit. f DSGVO). Ist ein Feedback erledigt, wird es 30
        Tage danach automatisch gelöscht; jedes Feedback wird spätestens 1 Jahr nach dem Absenden automatisch gelöscht.
        Löschst du dein Konto, wird dein Feedback sofort von deinem Konto getrennt und die Browser-Kennung entfernt.
      </p>

      <h2>9. Backups</h2>
      <p>
        Die Datenbank wird täglich gesichert. Aufbewahrt werden 7 tägliche, 4 wöchentliche und 6 monatliche Sicherungen.
        Sie liegen nur lokal auf dem Rechner des Verantwortlichen und werden nicht an Dritte oder Cloud-Dienste
        übertragen. Gelöschte oder anonymisierte Daten können daher bis zu etwa 6 Monate in Sicherungen enthalten sein.
        Sicherungen werden nur zur Wiederherstellung nach einem Fehler verwendet; wird eine Sicherung eingespielt,
        werden zwischenzeitlich gelöschte Konten erneut gelöscht.
      </p>

      <h2>10. Konto löschen</h2>
      <p>
        Du kannst dein Konto jederzeit selbst löschen: Einstellungen → „Konto löschen“, Bestätigung mit deinem Passwort.
        Dabei werden Benutzername, Passwort-Hash und Avatar entfernt, alle Anmeldungen beendet und dein Feedback sowie
        Einträge im Admin-Protokoll vom Konto getrennt (eine Begründung zu deinem Konto wird gelöscht). Deine bisherigen
        Runden und Hände bleiben für die anderen Spieler erhalten, erscheinen aber nur noch als „Gelöschter Spieler“ und
        lassen sich keinem Namen mehr zuordnen. Der Benutzername wird wieder frei.
      </p>

      <h2>11. Empfänger</h2>
      <p>
        Daten werden nicht verkauft und nicht an Dritte weitergegeben. Empfänger ist nur Cloudflare als
        Auftragsverarbeiter (Abschnitt 3); innerhalb der App sehen Mitspieler die in Abschnitt 7 genannten Angaben.
      </p>

      <h2>12. Deine Rechte</h2>
      <p>Du hast das Recht auf</p>
      <ul>
        <li>Auskunft über deine gespeicherten Daten (Art. 15 DSGVO),</li>
        <li>Berichtigung (Art. 16 DSGVO),</li>
        <li>Löschung (Art. 17 DSGVO) – am einfachsten selbst über „Konto löschen“,</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO),</li>
        <li>
          Widerspruch gegen Verarbeitungen, die auf berechtigtem Interesse beruhen (Art. 21 DSGVO), aus Gründen, die
          sich aus deiner besonderen Situation ergeben.
        </li>
      </ul>
      <p>
        Wende dich dafür an {PROVIDER.email}. Außerdem kannst du dich bei einer Datenschutz-Aufsichtsbehörde beschweren
        (Art. 77 DSGVO), z. B. bei der für den Verantwortlichen zuständigen Berliner Beauftragten für Datenschutz und
        Informationsfreiheit, Alt-Moabit 59–61, 10555 Berlin.
      </p>

      <h2>13. Pflicht zur Bereitstellung</h2>
      <p>
        Benutzername und Passwort brauchen wir, damit du ein Konto anlegen und spielen kannst. Ohne sie ist die Nutzung
        nicht möglich. Eine automatisierte Entscheidungsfindung oder Profilbildung im Sinne von Art. 22 DSGVO findet
        nicht statt; Statistiken dienen nur der Anzeige im Spiel.
      </p>
    </>
  );
}
