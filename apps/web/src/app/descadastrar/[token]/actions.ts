"use server";

import { sanitize } from "@creator-outdoor/domain";
import { unsubscribeFromNotifications } from "@/lib/api";
import type { UnsubscribeState } from "./state";

/**
 * Confirms an unsubscribe.
 *
 * The answer is the same whether the token was live, already used or never
 * existed. A page that said "unknown link" would let anybody forwarded an email
 * test whether an address is subscribed, and the person clicking their own link
 * only ever needs to be told it is done.
 */
export async function unsubscribeAction(
  _previous: UnsubscribeState,
  formData: FormData,
): Promise<UnsubscribeState> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length < 16) {
    return { status: "done" };
  }

  try {
    await unsubscribeFromNotifications(token);
  } catch (error) {
    console.error(
      "unsubscribe_failed",
      sanitize(error instanceof Error ? error.message : "unknown"),
    );
    return { status: "error" };
  }
  return { status: "done" };
}
