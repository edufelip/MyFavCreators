import type { ClaimVerificationOutcome } from "@creator-outdoor/contracts";

/**
 * Constants live apart from the `"use server"` modules, which may only export
 * async functions.
 */
export type ClaimState = {
  readonly stage: "idle" | "challenged" | "verified" | "failed";
  readonly code: string | null;
  readonly message: string | null;
  readonly outcome: ClaimVerificationOutcome | null;
};

export const INITIAL_CLAIM_STATE: ClaimState = {
  stage: "idle",
  code: null,
  message: null,
  outcome: null,
};

export type ManageState = { readonly message: string | null; readonly saved: boolean };
export const INITIAL_MANAGE_STATE: ManageState = { message: null, saved: false };
