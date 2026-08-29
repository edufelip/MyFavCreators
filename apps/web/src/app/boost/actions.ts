"use server";

import type { BoostOrigin } from "@creator-outdoor/contracts";
import { sanitize } from "@creator-outdoor/domain";
import { redirect } from "next/navigation";
import { createBoost, RateLimitedError } from "@/lib/api";
import { copy } from "@/lib/copy";
import { readOrCreateSupporterKey } from "@/lib/supporter";
import type { BoostFormState } from "./state";

function text(formData: FormData, field: string): string | undefined {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Starts a boost.
 *
 * The amount and the creator are read from the form but validated by the API:
 * nothing the browser sends is trusted, and the checkout page is only reachable
 * once a real payment exists.
 */
export async function startBoostAction(
  _previous: BoostFormState,
  formData: FormData,
): Promise<BoostFormState> {
  const creatorSlug = text(formData, "creatorSlug");
  const rawAmount = text(formData, "amountCents");
  if (creatorSlug === undefined) {
    return { error: copy.boostForm.chooseCreator };
  }
  const amountCents = Number.parseInt(rawAmount ?? "", 10);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { error: copy.boostForm.failed };
  }

  const supporterName = text(formData, "supporterName");
  const supporterMessage = text(formData, "supporterMessage");
  const supporterEmail = text(formData, "supporterEmail");
  const origin = text(formData, "origin");

  let paymentId: string;
  try {
    const checkout = await createBoost({
      creatorSlug,
      amountCents,
      origin: origin === "TAKE_FIRST_PLACE" ? "TAKE_FIRST_PLACE" : ("DIRECT" satisfies BoostOrigin),
      supporterKey: await readOrCreateSupporterKey(),
      anonymous: formData.get("anonymous") === "on",
      notifyOnDethrone: formData.get("notifyOnDethrone") === "on",
      notifyWeeklyRecap: formData.get("notifyWeeklyRecap") === "on",
      ...(supporterName === undefined ? {} : { supporterName }),
      ...(supporterMessage === undefined ? {} : { supporterMessage }),
      ...(supporterEmail === undefined ? {} : { supporterEmail }),
    });
    paymentId = checkout.paymentId;
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { error: "Muitas tentativas em pouco tempo. Tente novamente mais tarde." };
    }
    console.error(
      "boost_creation_failed",
      sanitize(error instanceof Error ? error.message : "unknown"),
    );
    return { error: copy.boostForm.failed };
  }

  redirect(`/impulsionar/${paymentId}`);
}
