import { unsubscribeFromNotifications } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The address RFC 8058 one-click unsubscribe actually posts to.
 *
 * `List-Unsubscribe` used to name the confirmation *page*. A page has no POST
 * handler, so a mail client's one-click request was answered by the page's own
 * GET rendering — HTTP 200, and nobody unsubscribed. Gmail, Yahoo and Apple
 * Mail read 200 as success and tell the reader it is done; the subscription
 * stayed active and the next email arrived. The header existed to keep somebody
 * from reporting us as spam, and it was doing the opposite.
 *
 * A route handler rather than a page because only a route handler can answer a
 * POST that is not a React server action. It has to live on its own path, since
 * a `route.ts` cannot sit beside a `page.tsx` in the same segment.
 */
export async function POST(
  _request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  try {
    await unsubscribeFromNotifications(token);
  } catch (error) {
    console.error("one_click_unsubscribe_failed", error instanceof Error ? error.name : "unknown");
    // A mail client retries a 5xx, which is what we want: the alternative is
    // telling somebody they are unsubscribed when they are not.
    return new Response(null, { status: 502 });
  }

  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/**
 * A person who clicks the link rather than a client that posts it.
 *
 * Redirect only. Mail clients prefetch links, and unsubscribing on a GET would
 * unsubscribe people who never clicked — which is the reason the confirmation
 * page exists at all.
 */
export async function GET(
  request: Request,
  context: { readonly params: Promise<{ readonly token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  return Response.redirect(
    new URL(`/descadastrar/${encodeURIComponent(token)}`, request.url).toString(),
    303,
  );
}
