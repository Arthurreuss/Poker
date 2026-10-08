// Admin-CLI: listet das neueste Feedback (WP-024), neueste zuerst. Aufruf und Beispiele: README, „Admin“.
//   npm run admin:feedback -w @poker/server -- [--status new|read|done|all] [--limit N]
// In prod gebündelt: docker compose -p poker-prod exec server node cli/feedback.mjs [...]
import { createPgDatabase } from '../db';
import { FEEDBACK_CLI_USAGE, formatFeedbackList, parseFeedbackCliArgs } from '../feedback/cli';
import { listFeedback } from '../feedback/store';

const args = parseFeedbackCliArgs(process.argv.slice(2));
const databaseUrl = process.env['DATABASE_URL'];
if (args === null || databaseUrl === undefined) {
  console.error(FEEDBACK_CLI_USAGE);
  process.exit(2);
}

const db = createPgDatabase(databaseUrl);
try {
  const items = await listFeedback(db, args);
  console.log(formatFeedbackList(items, args.status));
} catch (err) {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
