// Admin-CLI: setzt ein neues Passwort für einen User und beendet alle seine Sessions (D-011, WP-010).
// Aufruf und Beispiele: README, Abschnitt „Admin“.
//   npm run admin:reset-password -w @poker/server -- <benutzername>
// Ohne Eingabe auf stdin wird ein zufälliges Passwort erzeugt und einmalig ausgegeben;
// mit `echo 'neues-passwort' | npm run …` wird das Passwort von stdin gelesen (nie als Argument → Shell-History).
import { text } from 'node:stream/consumers';
import { generatePassword, resetPassword } from '../auth/admin';
import { createPgDatabase } from '../db';

const [username] = process.argv.slice(2);
const databaseUrl = process.env['DATABASE_URL'];
if (username === undefined || databaseUrl === undefined) {
  console.error('Aufruf: DATABASE_URL=… npm run admin:reset-password -w @poker/server -- <benutzername>');
  console.error("        (Passwort optional über stdin: echo 'neues-passwort' | …)");
  process.exit(2);
}

const fromStdin = process.stdin.isTTY ? '' : (await text(process.stdin)).replace(/\r?\n$/, '');
const generated = fromStdin === '';
const password = generated ? generatePassword() : fromStdin;

const db = createPgDatabase(databaseUrl);
try {
  if (!(await resetPassword(db, username, password))) {
    console.error(`Kein aktiver User „${username}“ gefunden.`);
    process.exitCode = 1;
  } else {
    console.log(`Passwort für „${username}“ gesetzt, alle Sessions beendet.`);
    if (generated) console.log(`Neues Passwort: ${password}`);
  }
} catch (err) {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
