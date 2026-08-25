import { headers } from "next/headers";
import { notFound, RedirectType, redirect } from "next/navigation";
import { readAnalyticsSession } from "@/lib/analytics-session";
import { resolveOutboundLink } from "@/lib/api";

export const dynamic = "force-dynamic";

type OutboundPageProps = {
  readonly params: Promise<{ readonly creatorLinkId: string }>;
};

/**
 * The tracked outbound redirect.
 *
 * Every public link to a creator's profile goes through here so the click can be
 * measured. The destination is never taken from the request: the API returns the
 * stored URL for a known link id, which is what stops this from becoming an open
 * redirect, and a link whose creator is no longer public stops resolving the
 * moment their status changes.
 *
 * A page rather than a route handler, so a dead link lands on the site's own
 * not-found page instead of a bare status code the browser renders as a network
 * error. That also means no cookie is written here: following a link is not a
 * reason to start tracking somebody who has no session yet, and their click
 * simply goes uncounted.
 *
 * Measurement is best effort relative to sending the visitor on their way. A
 * failure to count must never strand somebody who clicked a link.
 */
export default async function OutboundRedirect({ params }: OutboundPageProps) {
  const { creatorLinkId } = await params;
  const [sessionId, headerList] = await Promise.all([readAnalyticsSession(), headers()]);

  let destination: string | null = null;
  try {
    const resolved = await resolveOutboundLink(creatorLinkId, sessionId, headerList.get("referer"));
    destination = resolved?.url ?? null;
  } catch (error) {
    console.error("outbound_redirect_failed", error instanceof Error ? error.message : "unknown");
  }

  if (destination === null) {
    notFound();
  }
  redirect(destination, RedirectType.replace);
}
