import type { OptOutVerificationOutcome } from "@creator-outdoor/contracts";

/**
 * Ownership panel state. Kept out of the `"use server"` module, which may only
 * export async functions.
 */
export type OwnershipState = {
  readonly stage: "idle" | "challenged" | "verified" | "failed";
  readonly code: string | null;
  readonly message: string | null;
  readonly outcome: OptOutVerificationOutcome | null;
};

export const INITIAL_OWNERSHIP_STATE: OwnershipState = {
  stage: "idle",
  code: null,
  message: null,
  outcome: null,
};

export type ReportState = { readonly message: string | null };
export const INITIAL_REPORT_STATE: ReportState = { message: null };
