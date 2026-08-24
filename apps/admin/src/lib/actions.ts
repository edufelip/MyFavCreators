"use server";

import { verifyPassword } from "@creator-outdoor/config";
import { adminConfig } from "@creator-outdoor/config/admin";
import type { RejectionReasonDto } from "@creator-outdoor/contracts";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  approveCreator,
  rejectCreator,
  removeCreator,
  resolveReport,
  restoreCreator,
  updateCreatorMetadata,
} from "./api";
import { clearAttempts, isThrottled, recordFailedAttempt } from "./login-throttle";
import { endAdminSession, hasAdminSession, startAdminSession } from "./session";

/**
 * Origin validation for every mutation.
 *
 * Next.js already checks the Origin of a server action, and this repeats the
 * check explicitly against the configured origin so a misconfigured proxy
 * cannot silently widen it. Client state is never a security boundary.
 */
async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin !== null && origin !== adminConfig.adminOrigin) {
    throw new Error("Cross-origin administration request refused");
  }
}

async function requireSession(): Promise<void> {
  if (!(await hasAdminSession())) {
    redirect("/login");
  }
}

async function clientKey(): Promise<string> {
  const headerList = await headers();
  return (
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "local"
  );
}

export type LoginState = { readonly error: string | null };

export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  await assertSameOrigin();
  const key = await clientKey();
  if (isThrottled(key)) {
    return { error: "throttled" };
  }

  const password = formData.get("password");
  const provided = typeof password === "string" ? password : "";
  if (!verifyPassword(provided, adminConfig.adminPasswordHash)) {
    recordFailedAttempt(key);
    return { error: "invalid" };
  }

  clearAttempts(key);
  await startAdminSession();
  redirect("/moderacao");
}

export async function signOut(): Promise<void> {
  await assertSameOrigin();
  await endAdminSession();
  redirect("/login");
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
  await requireSession();
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
  await requireSession();
  const id = requiredString(formData, "creatorId");
  const reason = requiredString(formData, "reason") as RejectionReasonDto;
  await rejectCreator(id, reason, optionalString(formData, "note"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function removeCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireSession();
  const id = requiredString(formData, "creatorId");
  await removeCreator(id, optionalString(formData, "note"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function restoreCreatorAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireSession();
  await restoreCreator(requiredString(formData, "creatorId"));
  revalidatePath("/moderacao");
  redirect("/moderacao");
}

export async function updateMetadataAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireSession();
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

export async function resolveReportAction(formData: FormData): Promise<void> {
  await assertSameOrigin();
  await requireSession();
  await resolveReport(requiredString(formData, "reportId"));
  revalidatePath("/denuncias");
}
