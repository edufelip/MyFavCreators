import { sanitize } from "@creator-outdoor/domain";
import { fetchPaymentStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * A same-origin proxy for payment status polling.
 *
 * The checkout screen polls its own origin rather than the API directly, so the
 * browser needs no cross-origin permission and the API's CORS allowlist stays
 * as narrow as it is. It only ever forwards a read.
 */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly paymentId: string }> },
): Promise<Response> {
  const { paymentId } = await context.params;
  try {
    const status = await fetchPaymentStatus(paymentId);
    if (status === null) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return Response.json(status, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(
      "payment_status_proxy_failed",
      sanitize(error instanceof Error ? error.message : "unknown"),
    );
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
