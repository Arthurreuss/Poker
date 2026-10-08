import { FeedbackButton } from './FeedbackDialog';

/**
 * Feedback-Einstieg in der App-Shell (WP-024): Knopf „Feedback“ neben dem Menü, öffnet das Formular.
 * Für das Tisch-Menü (ohne App-Shell) gibt es `useFeedbackDialog` aus `./index`.
 */
export function FeedbackSlot() {
  return (
    <span data-slot="feedback">
      <FeedbackButton />
    </span>
  );
}
