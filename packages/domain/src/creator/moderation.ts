export const MODERATION_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "REMOVED",
  "OPTOUT_VERIFICATION_PENDING",
  "OPTED_OUT",
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const REJECTION_REASONS = [
  "NOT_PUBLIC_OR_PROFESSIONAL",
  "MINOR",
  "DUPLICATE",
  "MALICIOUS_URL",
  "IMPERSONATION",
  "INVALID_PROFILE",
  "OTHER",
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export const CLAIM_STATUSES = ["UNCLAIMED", "PENDING", "CLAIMED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function isModerationStatus(value: unknown): value is ModerationStatus {
  return typeof value === "string" && (MODERATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Public eligibility. An APPROVED creator is the only kind that may appear
 * publicly, rank, receive new boosts, enter rotation, reach category pages,
 * enter the sitemap or generate a public OG card.
 */
export function isPubliclyEligible(status: ModerationStatus): boolean {
  return status === "APPROVED";
}
