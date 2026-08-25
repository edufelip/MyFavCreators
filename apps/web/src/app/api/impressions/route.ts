import { readOrCreateAnalyticsSession } from "@/lib/analytics-session";
import { type ImpressionEntry, RateLimitedError, reportImpressions } from "@/lib/api";

export const dynamic = "force-dynamic";

const SURFACES = ["MARQUEE", "LEADERBOARD", "ROTATION", "CREATOR_PAGE", "EMBED"] as const;
const MAX_ENTRIES = 120;

function readEntries(payload: unknown): readonly ImpressionEntry[] | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const entries = (payload as { entries?: unknown }).entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ENTRIES) {
    return null;
  }

  const parsed: ImpressionEntry[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const creatorId = (entry as { creatorId?: unknown }).creatorId;
    const surface = (entry as { surface?: unknown }).surface;
    if (typeof creatorId !== "string" || creatorId.length !== 36) {
      return null;
    }
    const match = SURFACES.find((candidate) => candidate === surface);
    if (match === undefined) {
      return null;
    }
    parsed.push({ creatorId, surface: match });
  }
  return parsed;
}

/**
 * Same-origin ingestion for the delivery beacon.
 *
 * The browser posts what it displayed; the session identifier is added here
 * from an httpOnly cookie the page cannot read. The body is validated before
 * it leaves this process, so a malformed beacon is rejected at the edge rather
 * than being forwarded for the API to reject again.
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

  const entries = readEntries(payload);
  if (entries === null) {
    /*
     * Loud, because this used to be silent. The answer is always 204, so a
     * beacon whose shape the route did not accept was dropped here with nothing
     * anywhere to say so — and the delivery report every creator sees was built
     * from an empty table for exactly as long as that lasted. The content is not
     * logged, only that something was refused.
     */
    console.error("impression_beacon_rejected");
    return noContent;
  }

  try {
    await reportImpressions(await readOrCreateAnalyticsSession(), entries);
  } catch (error) {
    if (!(error instanceof RateLimitedError)) {
      console.error("impression_ingest_failed", error instanceof Error ? error.message : "unknown");
    }
  }
  return noContent;
}
