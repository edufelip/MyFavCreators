"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  fetchCreatorDashboard,
  requestCreatorClaim,
  setCreatorNotifications,
  updateCreatorProfile,
  verifyCreatorClaim,
} from "@/lib/api";
import { copy } from "@/lib/copy";
import { clearManageToken, readManageToken, storeManageToken } from "@/lib/manage-session";
import { type ClaimState, INITIAL_CLAIM_STATE, type ManageState } from "./state";

function slugOf(formData: FormData): string {
  const slug = formData.get("slug");
  if (typeof slug !== "string" || slug === "") {
    throw new Error("Missing creator slug");
  }
  return slug;
}

function textOf(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

/**
 * Opens a claim.
 *
 * Issues a code that has to appear on the profile and changes nothing public,
 * which is what stops somebody claiming a profile they do not control.
 */
export async function requestClaimAction(
  _previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  try {
    const challenge = await requestCreatorClaim(slugOf(formData));
    return {
      stage: "challenged",
      code: challenge.code,
      message: challenge.instructions,
      outcome: null,
    };
  } catch (error) {
    console.error("claim_request_failed", error instanceof Error ? error.message : "unknown");
    return { ...INITIAL_CLAIM_STATE, stage: "failed", message: copy.submission.unavailable };
  }
}

/**
 * Completes a claim.
 *
 * The management token is put straight into an httpOnly cookie and never
 * returned to the page: the browser holds it, no script can read it, and it
 * never appears in a URL.
 */
export async function verifyClaimAction(
  previous: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const profileText = textOf(formData, "profileText");
  if (profileText.trim() === "") {
    return { ...previous, outcome: "CODE_NOT_FOUND", message: copy.claim.outcomes.CODE_NOT_FOUND };
  }

  const email = textOf(formData, "email").trim();
  try {
    const result = await verifyCreatorClaim(
      slugOf(formData),
      profileText,
      email === "" ? null : email,
    );
    if (result.outcome !== "VERIFIED" || result.manageToken === null) {
      return {
        stage: previous.stage,
        code: previous.code,
        message: result.message,
        outcome: result.outcome,
      };
    }
    await storeManageToken(result.manageToken);
  } catch (error) {
    console.error("claim_verify_failed", error instanceof Error ? error.message : "unknown");
    return { ...previous, stage: "failed", message: copy.submission.unavailable };
  }

  redirect("/gerenciar");
}

export async function updateProfileAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const token = await readManageToken();
  if (token === null) {
    return { message: copy.manage.signedOut, saved: false };
  }

  const bio = textOf(formData, "bio");
  const categorySlug = textOf(formData, "categorySlug");
  try {
    const updated = await updateCreatorProfile(token, {
      bio: bio.trim() === "" ? null : bio,
      ...(categorySlug === "" ? {} : { categorySlug }),
    });
    if (updated === null) {
      return { message: copy.manage.signedOut, saved: false };
    }
  } catch (error) {
    console.error("profile_update_failed", error instanceof Error ? error.message : "unknown");
    return { message: copy.manage.unavailable, saved: false };
  }

  revalidatePath("/gerenciar");
  return { message: copy.manage.saved, saved: true };
}

export async function setNotificationsAction(
  _previous: ManageState,
  formData: FormData,
): Promise<ManageState> {
  const token = await readManageToken();
  if (token === null) {
    return { message: copy.manage.signedOut, saved: false };
  }

  const email = textOf(formData, "email").trim();
  try {
    const applied = await setCreatorNotifications(
      token,
      {
        notifyDethrone: formData.get("notifyDethrone") === "on",
        notifyWeeklyRecap: formData.get("notifyWeeklyRecap") === "on",
      },
      email === "" ? null : email,
    );
    if (!applied) {
      // The session expired. Saying "saved" here would leave somebody believing
      // they had turned a notification off when they had not.
      return { message: copy.manage.signedOut, saved: false };
    }
  } catch (error) {
    console.error("notification_pref_failed", error instanceof Error ? error.message : "unknown");
    return { message: copy.manage.unavailable, saved: false };
  }

  revalidatePath("/gerenciar");
  return { message: copy.manage.saved, saved: true };
}

/** Ends the management session in this browser. The claim itself is untouched. */
export async function signOutManageAction(): Promise<void> {
  await clearManageToken();
  // The management page is cached per navigation; without this the browser can
  // render a signed-in view from before the cookie went away.
  revalidatePath("/gerenciar");
  redirect("/");
}

/** Whether this browser still holds a live management session. */
export async function currentDashboard() {
  const token = await readManageToken();
  return token === null ? null : fetchCreatorDashboard(token);
}
