import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import { SUPPORTER_KEY_COOKIE } from "@creator-outdoor/contracts";
import { cookies } from "next/headers";

/**
 * The persistent supporter identifier for this browser.
 *
 * Deliberately separate from the analytics session id: mixing them would let
 * analytics deduplication reshape who counts as a supporter, and would put one
 * system's identifier inside the other's. It is never exposed publicly — it only
 * travels from this server to the API, where it is turned into an HMAC.
 */
export async function readOrCreateSupporterKey(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SUPPORTER_KEY_COOKIE)?.value;
  if (existing !== undefined && existing.length >= 8) {
    return existing;
  }

  const created = crypto.randomUUID();
  store.set(SUPPORTER_KEY_COOKIE, created, {
    httpOnly: true,
    secure: webConfig.cookiesAreSecure,
    sameSite: "lax",
    path: "/",
    maxAge: webConfig.product.supporterCookieDays * 24 * 60 * 60,
  });
  return created;
}
