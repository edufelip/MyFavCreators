import type { ModerationStatus } from "./moderation";

/**
 * The moderation lifecycle.
 *
 * Every transition is explicit: an arbitrary status write can put a creator on
 * the public leaderboard, or take a creator who opted out and put them back, so
 * the set of legal moves is data rather than scattered conditionals.
 *
 * `OPTED_OUT` is terminal. A verified opt-out is the creator's own decision, and
 * no administrator action reverses it; the profile is also suppressed against
 * resubmission.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ModerationStatus, readonly ModerationStatus[]>> = {
  PENDING_REVIEW: ["APPROVED", "REJECTED", "REMOVED"],
  APPROVED: ["REMOVED", "REJECTED", "OPTOUT_VERIFICATION_PENDING", "OPTED_OUT"],
  REJECTED: ["APPROVED", "REMOVED"],
  REMOVED: ["APPROVED", "REJECTED"],
  OPTOUT_VERIFICATION_PENDING: ["OPTED_OUT", "APPROVED", "REMOVED"],
  OPTED_OUT: [],
};

export function canTransitionModeration(from: ModerationStatus, to: ModerationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedModerationTransitions(from: ModerationStatus): readonly ModerationStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export class InvalidModerationTransitionError extends Error {
  override readonly name = "InvalidModerationTransitionError";

  constructor(
    readonly from: ModerationStatus,
    readonly to: ModerationStatus,
  ) {
    super(`A creator cannot move from ${from} to ${to}`);
  }
}

export function assertModerationTransition(from: ModerationStatus, to: ModerationStatus): void {
  if (!canTransitionModeration(from, to)) {
    throw new InvalidModerationTransitionError(from, to);
  }
}

/** A verified opt-out also suppresses the profile against resubmission. */
export function requiresSuppression(to: ModerationStatus): boolean {
  return to === "OPTED_OUT";
}
