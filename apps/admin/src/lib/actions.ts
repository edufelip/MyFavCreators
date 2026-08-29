"use server";

import { adminConfig } from "@creator-outdoor/config/admin";
import type { RejectionReasonDto } from "@creator-outdoor/contracts";
import { REJECTION_REASONS } from "@creator-outdoor/domain";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  AdminApiError,
  approveCreator,
  refundPayment,
  rejectCreator,
  removeCreator,
  resolveReport,
  restoreCreator,
  updateCreatorMetadata,
} from "./api";
import { authenticateOperator } from "./operator-auth";
import { currentOperator, endAdminSession, startAdminSession } from "./session";

/**
 * Origin validation for every mutation.
 *
 * Next.js already checks the Origin of a server action, and this repeats the
 * check explicitly against the configured origin so a misconfigured proxy
 * cannot silently widen it. Client state is never a security boundary.
 *
 * A request with no Origin at all is refused. Every browser attaches one to a
 * server action, so an absent header is not a browser being polite about
 * privacy — it is something that is not the admin app, and treating "absent" as
 * "fine" is exactly the hole the check exists to close.
 */
async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin !== adminConfig.adminOrigin) {
    throw new Error("Cross-origin administration request refused");
  }
}

/**
 * The operator behind this request, or a redirect to the login page.
 *
 * Returns the name rather than a boolean because every mutation has to say who
 * did it: the audit log records this exact value, and there is no path that
 * writes an action without one.
 */
async function requireOperator(): Promise<string> {
  const operator = await currentOperator();
  if (operator === null) {
    redirect("/login");
  }
  return operator;
}

export type LoginState = { readonly error: string | null };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Signing in.
 *
 * Two factors are required and the failure message never distinguishes between
 * them: "wrong password" and "wrong code" and "no such operator" all read the
 * same, because telling them apart is free reconnaissance for whoever is
 * guessing.
 */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  await assertSameOrigin();

  const outcome = authenticateOperator(
    adminConfig.adminOperators,
    {
      operator: field(formData, "operator").toLowerCase(),
      password:
        typeof formData.get("password") === "string" ? String(formData.get("password")) : "",
      code: field(formData, "code").replace(/\s/g, ""),
    },
    { isLiveDeployment: adminConfig.isLiveDeployment },
  );

  if (outcome.kind === "THROTTLED") {
    return { error: "throttled" };
  }
  if (outcome.kind === "PUBLISHED_CREDENTIALS") {
    return { error: "published-credentials" };
  }
  if (outcome.kind === "INVALID") {
    return { error: "invalid" };
  }

  await startAdminSession(outcome.operator);
  redirect("/moderacao");
}

export async function signOut(): Promise<void> {
  await assertSameOrigin();
  await endAdminSession();
  redirect("/login");
}

/**
 * The rejection reason, checked against the published list.
 *
 * Asserting a form value into this type told the compiler something nobody had
 * checked. The API would have refused a bad one, but "the next system will
 * catch it" is not the same as knowing.
 */
function rejectionReason(formData: FormData): RejectionReasonDto {
  const raw = requiredString(formData, "reason");
  const match = REJECTION_REASONS.find((candidate) => candidate === raw);
  if (match === undefined) {
    throw new Error("Unknown rejection reason");
  }
  return match;
}

function requiredString(formData: FormData, field: string): string {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing form field: ${field}`);
  }
  return value.trim();
}

function optionalString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function approveCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  const id = requiredString(formData, "creatorId");
  const displayName = optionalString(formData, "displayName");
  const bio = optionalString(formData, "bio");
  const avatarUrl = optionalString(formData, "avatarUrl");
  const categorySlug = optionalString(formData, "categorySlug");
  await approveCreator(id, {
    ...(displayName === undefined ? {} : { displayName }),
    ...(bio === undefined ? {} : { bio }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(categorySlug === undefined ? {} : { categorySlug }),
  });
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function rejectCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  const id = requiredString(formData, "creatorId");
  const reason = rejectionReason(formData);
  await rejectCreator(id, reason, optionalString(formData, "note"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function removeCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  const id = requiredString(formData, "creatorId");
  await removeCreator(id, optionalString(formData, "note"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function restoreCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  await restoreCreator(requiredString(formData, "creatorId"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function updateMetadataAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  const id = requiredString(formData, "creatorId");
  const displayName = optionalString(formData, "displayName");
  const bio = optionalString(formData, "bio");
  const avatarUrl = optionalString(formData, "avatarUrl");
  const categorySlug = optionalString(formData, "categorySlug");
  await updateCreatorMetadata(id, {
    ...(displayName === undefined ? {} : { displayName }),
    ...(bio === undefined ? {} : { bio }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    ...(categorySlug === undefined ? {} : { categorySlug }),
  });
  revalidatePath("/moderacao");
}

/**
 * Sends a payment back to whoever paid it.
 *
 * The reason is required, and it is the operator's own words: nothing else in
 * the record can say why somebody decided to give the money back. Nothing here
 * moves money toward a creator — a refund unsells prominence, which is the only
 * thing the platform ever sold.
 */
export type RefundState = { readonly error: string | null };

export async function refundPaymentAction(
  _previous: RefundState,
  formData: FormData,
): Promise<RefundState> {
  await assertSameOrigin();
  await requireOperator();

  try {
    await refundPayment(requiredString(formData, "paymentId"), requiredString(formData, "reason"));
  } catch (error) {
    /*
     * Shown on the screen rather than allowed to reach the error boundary. The
     * API distinguishes "the provider was never reached, nothing changed" from
     * "the instruction went out and was not confirmed", and those are different
     * instructions to a person: one says retry, the other says go and look
     * before you retry. The boundary can only say one thing, and it said the
     * wrong one for the case where money may already be gone.
     */
    if (error instanceof AdminApiError) {
      return { error: error.operatorMessage };
    }
    throw error;
  }

  revalidatePath("/pagamentos");
  redirect("/pagamentos");
}

export async function resolveReportAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireOperator();
  await resolveReport(requiredString(formData, "reportId"));
  revalidatePath("/denuncias");
}
