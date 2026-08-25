/**
 * The notifications somebody can ask for.
 *
 * Each is a separate subscription with its own unsubscribe token, because each
 * is a separate thing to agree to: "tell me when this profile loses the top
 * spot" is not "send me a weekly summary", and a single switch covering both
 * would be consent for one used as permission for the other.
 */
export const NOTIFICATION_TYPES = ["DETHRONE", "WEEKLY_RECAP"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
