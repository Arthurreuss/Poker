// Admin-CLI: setzt (oder mit --revoke entzieht) das Admin-Flag eines Users (WP-010).
// Aufruf: DATABASE_URL=… npm run admin:make-admin -w @poker/server -- <benutzername> [--revoke]
import { setAdmin } from '../auth/admin';
import { createPgDatabase } from '../db';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const [username] = args.filter((a) => a !== '--revoke');
const databaseUrl = process.env['DATABASE_URL'];
if (username === undefined || databaseUrl === undefined) {
  console.error('Aufruf: DATABASE_URL=… npm run admin:make-admin -w @poker/server -- <benutzername> [--revoke]');
  process.exit(2);
}

const db = createPgDatabase(databaseUrl);
try {
  if (await setAdmin(db, username, !revoke)) {
    console.log(`„${username}“ ist ${revoke ? 'kein Admin mehr' : 'jetzt Admin'}.`);
  } else {
    console.error(`Kein aktiver User „${username}“ gefunden.`);
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
