// Feedback-Endpunkte (WP-024, Formate: docs/ARCHITECTURE.md, „Datenmodell“ → „Feedback“).
import type { OrientationPreference } from '../settings/orientation';
import { apiRequest } from './client';

export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'other'] as const;
export const FEEDBACK_STATUSES = ['new', 'read', 'done'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Body von `POST /api/feedback`; den User-Agent liest der Server selbst aus dem Header. */
export interface NewFeedback {
  category: FeedbackCategory;
  message: string;
  page: string | null;
  tableId: number | null;
  appVersion: string | null;
  orientation: OrientationPreference | null;
}

export interface FeedbackItem {
  id: number;
  /** `null` = Account gelöscht. */
  userId: number | null;
  username: string | null;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  tableId: number | null;
  appVersion: string | null;
  userAgent: string | null;
  orientation: OrientationPreference | null;
  status: FeedbackStatus;
  /** ISO-Zeitpunkt. */
  createdAt: string;
}

export type FeedbackCounts = Record<FeedbackStatus, number>;

export interface FeedbackList {
  feedback: FeedbackItem[];
  counts: FeedbackCounts;
}

export async function sendFeedback(feedback: NewFeedback): Promise<{ id: number; createdAt: string }> {
  return (
    await apiRequest<{ feedback: { id: number; createdAt: string } }>('/api/feedback', {
      method: 'POST',
      body: feedback,
    })
  ).feedback;
}

/** Nur Admins. `status` = `null` → alle. */
export async function listFeedback(status: FeedbackStatus | null, signal?: AbortSignal): Promise<FeedbackList> {
  const path = status === null ? '/api/admin/feedback' : `/api/admin/feedback?status=${status}`;
  return apiRequest<FeedbackList>(path, signal === undefined ? {} : { signal });
}

/** Nur Admins. */
export async function updateFeedbackStatus(id: number, status: FeedbackStatus): Promise<FeedbackItem> {
  return (
    await apiRequest<{ feedback: FeedbackItem }>(`/api/admin/feedback/${String(id)}`, {
      method: 'PATCH',
      body: { status },
    })
  ).feedback;
}
