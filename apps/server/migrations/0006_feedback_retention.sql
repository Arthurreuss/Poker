-- WP-022: Speicherdauer von Feedback (D-025). Erledigtes Feedback wird 30 Tage nach dem Erledigen gelöscht, jedes
-- Feedback spätestens 1 Jahr nach dem Absenden – der Job dazu läuft im Server (feedback/retention.ts).
-- done_at = Zeitpunkt, zu dem der Status auf 'done' gesetzt wurde; NULL für 'new' und 'read'. Wird ein erledigtes
-- Feedback wieder geöffnet, wird done_at geleert (feedback/store.ts, updateFeedbackStatus).
ALTER TABLE feedback ADD COLUMN done_at timestamptz;

-- Altbestand: Wann bereits erledigtes Feedback erledigt wurde, ist unbekannt – die 30 Tage laufen ab der Migration.
UPDATE feedback SET done_at = now() WHERE status = 'done';

ALTER TABLE feedback
  ADD CONSTRAINT feedback_done_at CHECK ((status = 'done') = (done_at IS NOT NULL));

-- Löschjob: erledigte nach done_at, alle nach created_at (feedback_created_idx gibt es schon).
CREATE INDEX feedback_done_at_idx ON feedback (done_at) WHERE done_at IS NOT NULL;
