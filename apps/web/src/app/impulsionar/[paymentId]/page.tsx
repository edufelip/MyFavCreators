import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { renderSVG } from "uqr";
import { CheckoutView } from "@/components/checkout-view";
import { fetchCheckout, fetchPaymentStatus } from "@/lib/api";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.checkout.title,
  // A payment screen is never indexed.
  robots: { index: false, follow: false },
};

type CheckoutPageProps = { readonly params: Promise<{ readonly paymentId: string }> };

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { paymentId } = await params;
  const [checkout, status] = await Promise.all([
    fetchCheckout(paymentId),
    fetchPaymentStatus(paymentId),
  ]);
  if (checkout === null || status === null) {
    notFound();
  }

  // Rendered on the server: the QR is a picture of the payload, so there is no
  // reason to ship a QR encoder to the browser.
  const qrSvg = renderSVG(checkout.qrCode, { border: 2 });

  return <CheckoutView checkout={checkout} initialStatus={status} qrSvg={qrSvg} />;
}
