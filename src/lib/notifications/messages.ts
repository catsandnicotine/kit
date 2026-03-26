/**
 * Notification message templates for Kit.
 *
 * Rules:
 *  - No DB, React, or platform imports — pure functions only.
 *  - Never guilt-trip. Keep copy factual and frame the ask as small.
 *  - Every exported function returns a NotificationPayload.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A ready-to-schedule notification payload. */
export interface NotificationPayload {
  /** Short notification title (deck name or app name). */
  title: string;
  /** One-line notification body. */
  body: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an estimated review duration from total seconds into a short string.
 *
 * @param totalSeconds - Total estimated seconds for the session.
 * @returns e.g. "about 5 minutes", "about 1 hour", "about 2 hours"
 */
function formatEstimatedTime(totalSeconds: number): string {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) {
    return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

/**
 * Daily study reminder showing actual card count and estimated time.
 *
 * Example: "Japanese: 15 cards due, about 5 minutes"
 *
 * @param deckName          - Human-readable deck name.
 * @param cardCount         - Number of cards due right now.
 * @param avgSecondsPerCard - Average seconds per card (default 20s, based on
 *                            historical review_log data when available).
 * @returns Notification payload.
 */
export function makeDailyReminder(
  deckName: string,
  cardCount: number,
  avgSecondsPerCard = 20,
): NotificationPayload {
  const count = Math.max(1, cardCount);
  const timeStr = formatEstimatedTime(count * avgSecondsPerCard);
  return {
    title: deckName,
    body: `${count} ${count === 1 ? 'card' : 'cards'} due, ${timeStr}`,
  };
}

/**
 * Re-engagement message after 2 days without studying.
 * Focuses on what is happening to the cards, not blame.
 *
 * @returns Notification payload.
 */
export function makeReEngagement2Day(): NotificationPayload {
  return {
    title: 'Kit',
    body: 'Your hardest cards are slipping — tap to review a few.',
  };
}

/**
 * Re-engagement message after 7 days without studying.
 * Invites the user back without pressure.
 *
 * @returns Notification payload.
 */
export function makeReEngagement7Day(): NotificationPayload {
  return {
    title: 'Welcome back',
    body: 'Set your session size and ease back in.',
  };
}

/**
 * Weekly summary notification.
 *
 * Example: "You studied 142 cards across 5 days this week."
 *
 * @param cardsStudied - Total cards reviewed in the past 7 days.
 * @param daysStudied  - Number of distinct days with at least one review.
 * @returns Notification payload.
 */
export function makeWeeklySummary(
  cardsStudied: number,
  daysStudied: number,
): NotificationPayload {
  const cardStr = `${cardsStudied} ${cardsStudied === 1 ? 'card' : 'cards'}`;
  const dayStr  = `${daysStudied} ${daysStudied === 1 ? 'day' : 'days'}`;
  return {
    title: 'Weekly summary',
    body: `You studied ${cardStr} across ${dayStr} this week.`,
  };
}
