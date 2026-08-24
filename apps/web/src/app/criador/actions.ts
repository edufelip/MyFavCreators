"use server";

import type { ReportReason } from "@creator-outdoor/contracts";
import { reportCreator, requestCreatorOptOut, verifyCreatorOptOut } from "@/lib/api";
import { copy } from "@/lib/copy";
import { INITIAL_OWNERSHIP_STATE, type OwnershipState, type ReportState } from "./state";

function slugOf(formData: FormData): string {
  const slug = formData.get("slug");
  if (typeof slug !== "string" || slug === "") {
    throw new Error("Missing creator slug");
  }
  return slug;
}

/**
 * Opens a removal request.
 *
 * This deliberately does not hide anything. It only issues a code that has to
 * appear on the profile, which is what stops an unauthenticated visitor from
 * griefing a creator by asking for their removal.
 */
export async function requestOptOutAction(
  _previous: OwnershipState,
  formData: FormData,
): Promise<OwnershipState> {
  try {
    const challenge = await requestCreatorOptOut(slugOf(formData));
    return {
      stage: "challenged",
      code: challenge.code,
      message: challenge.instructions,
      outcome: null,
    };
  } catch (error) {
    console.error("opt_out_request_failed", error instanceof Error ? error.message : "unknown");
    return { ...INITIAL_OWNERSHIP_STATE, stage: "failed", message: copy.submission.unavailable };
  }
}

export async function verifyOptOutAction(
  previous: OwnershipState,
  formData: FormData,
): Promise<OwnershipState> {
  const profileText = formData.get("profileText");
  if (typeof profileText !== "string" || profileText.trim() === "") {
    return { ...previous, outcome: "CODE_NOT_FOUND", message: copy.optOut.outcomes.CODE_NOT_FOUND };
  }
  try {
    const result = await verifyCreatorOptOut(slugOf(formData), profileText);
    return {
      stage: result.outcome === "VERIFIED" ? "verified" : previous.stage,
      code: previous.code,
      message: result.message,
      outcome: result.outcome,
    };
  } catch (error) {
    console.error("opt_out_verify_failed", error instanceof Error ? error.message : "unknown");
    return { ...previous, stage: "failed", message: copy.submission.unavailable };
  }
}

export async function reportCreatorAction(
  _previous: ReportState,
  formData: FormData,
): Promise<ReportState> {
  const reason = formData.get("reason");
  const details = formData.get("details");
  try {
    const result = await reportCreator(slugOf(formData), {
      reason: (typeof reason === "string" ? reason : "OTHER") as ReportReason,
      ...(typeof details === "string" && details.trim() !== "" ? { details: details.trim() } : {}),
    });
    return { message: result.message };
  } catch (error) {
    console.error("report_failed", error instanceof Error ? error.message : "unknown");
    return { message: copy.submission.unavailable };
  }
}
