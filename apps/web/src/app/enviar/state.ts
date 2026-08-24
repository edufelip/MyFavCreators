import type { CreatorSubmissionOutcome } from "@creator-outdoor/contracts";

/**
 * The submission form's state.
 *
 * Lives outside the `"use server"` module because a server-action file may only
 * export async functions: a constant exported from one is a build-time error.
 */
export type SubmissionState = {
  readonly outcome: CreatorSubmissionOutcome | null;
  readonly message: string | null;
  readonly creatorSlug: string | null;
};

export const INITIAL_SUBMISSION_STATE: SubmissionState = {
  outcome: null,
  message: null,
  creatorSlug: null,
};
