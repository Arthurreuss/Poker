// Öffentliche Schnittstelle des Feedback-Moduls.
export {
  FeedbackButton,
  FeedbackDialog,
  useFeedbackDialog,
  type FeedbackButtonProps,
  type FeedbackDialogHandle,
  type FeedbackDialogProps,
} from './FeedbackDialog';
export { FeedbackForm, CATEGORY_LABELS, FEEDBACK_MAX_LENGTH, type FeedbackFormProps } from './FeedbackForm';
export { buildFeedbackContext, tableIdFromPath, type FeedbackContextOptions } from './context';
export { FeedbackSlot } from './FeedbackSlot';
