import { webConfig } from "@creator-outdoor/config/web";
import { readAnalyticsSession } from "@/lib/analytics-session";

export const dynamic = "force-dynamic";

/**
 * The embeddable badge, served from the public origin.
 *
 * Creators paste this URL into their own pages, so it has to be the address
 * people already trust — the API origin is an implementation detail that a
 * deployment may not even expose. Proxying here also lets the badge count an
 * EMBED impression when the viewer already has a session, without the embedding
 * page ever seeing a cookie.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const clean = slug.replace(/\.svg$/, "");
  const sessionId = await readAnalyticsSession();

  try {
    const upstream = await fetch(
      new URL(`/v1/creators/${encodeURIComponent(clean)}/badge.svg`, webConfig.apiOrigin),
      {
        headers: {
          accept: "image/svg+xml",
          ...(sessionId === null ? {} : { "x-analytics-session": sessionId }),
        },
        cache: "no-store",
      },
    );
    if (!upstream.ok) {
      return new Response(null, { status: 404 });
    }
    return new Response(await upstream.text(), {
      status: 200,
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        // The badge exists to be embedded on other people's pages.
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    console.error("badge_proxy_failed", error instanceof Error ? error.message : "unknown");
    return new Response(null, { status: 502 });
  }
}
