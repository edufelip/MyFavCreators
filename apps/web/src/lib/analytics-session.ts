import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import { ANALYTICS_SESSION_COOKIE } from "@creator-outdoor/contracts";
import { cookies } from "next/headers";

/** Long enough to deduplicate a visit, short enough not to be an identity. */
const SESSION_DAYS = 30;

/**
 * The analytics session identifier for this browser.
 *
 * httpOnly on purpose: browser scripts never read it, so a page cannot invent
 * sessions to inflate a creator's delivery numbers, and the value only ever
 * travels from this server to the API.
 *
 * Deliberately separate from the supporter key. Mixing them would let analytics
 * deduplication reshape who counts as a supporter, and would put one system's
 * identifier inside the other's.
 */
export async function readOrCreateAnalyticsSession(): Promise<string> {
  const store = await cookies();
  const existing = store.get(ANALYTICS_SESSION_COOKIE)?.value;
  if (existing !== undefined && existing.length >= 8) {
    return existing;
  }

  const created = crypto.randomUUID();
  store.set(ANALYTICS_SESSION_COOKIE, created, {
    httpOnly: true,
    // Whether the site is actually served over TLS, which is what `Secure`
    // means — not whether NODE_ENV says "production". `next start` sets that
    // variable whatever the scheme, so the two disagree on any HTTP stack, and
    // the cookie the browser then refuses to keep is the one that makes a click
    // countable. A deployment on https keeps the flag; one on http never had it.
    secure: webConfig.webOrigin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return created;
}

/**
 * Reads the session without creating one.
 *
 * A route that only measures must not mint an identifier as a side effect: a
 * request that arrives without a session is a request that goes uncounted, not
 * a reason to start tracking somebody.
 */
export async function readAnalyticsSession(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(ANALYTICS_SESSION_COOKIE)?.value;
  return existing !== undefined && existing.length >= 8 ? existing : null;
}
