import { ImpressionBatchRequestDto, matchesContract } from "@creator-outdoor/contracts";
import { sanitize } from "@creator-outdoor/domain";
import { readOrCreateAnalyticsSession } from "@/lib/analytics-session";
import { RateLimitedError, reportImpressions } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Same-origin ingestion for the delivery beacon.
 *
 * The browser posts what it displayed; the session identifier is added here
 * from an httpOnly cookie the page cannot read. The body is validated before it
 * leaves this process, so a malformed beacon is rejected at the edge rather
 * than being forwarded for the API to reject again.
 *
 * Validated against the published contract, not against a parser written by
 * hand here. The hand-written one disagreed with the beacon about the shape of
 * the payload — it expected `{ entries }` and the beacon sent a bare array — and
 * because the answer is always 204, every real page view was dropped in silence
 * for the whole life of the feature. Two sides of a boundary that agree only by
 * memory will eventually stop agreeing.
 *
 * The answer is always 204: measurement is never worth telling a page about,
 * and a response that varied would let a caller probe which creators exist.
 */
export async function POST(request: Request): Promise<Response> {
  const noContent = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return noContent;
  }

  if (!matchesContract(ImpressionBatchRequestDto, payload)) {
    /*
     * Loud, because this used to be silent. The status says nothing, so without
     * a line here a beacon the route refuses leaves no trace anywhere — and the
     * delivery report every creator reads is built from whatever survives. The
     * content is not logged, only that something was refused.
     */
    console.error("impression_beacon_rejected");
    return noContent;
  }

  try {
    await reportImpressions(await readOrCreateAnalyticsSession(), payload.entries);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) {
      console.error(
        "impression_ingest_failed",
        sanitize(error instanceof Error ? error.message : "unknown"),
      );
    }
  }
  return noContent;
}
