"use client";

import { useState } from "react";
import { refundPaymentAction } from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

/**
 * Sending money back.
 *
 * Two steps on purpose. A refund is irreversible and moves real money, so the
 * button that starts it is not the button that does it: the operator has to
 * write down why first, and that reason is what the audit log keeps.
 */
export function RefundForm({ paymentId }: { readonly paymentId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="refund-open"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/10"
      >
        {adminCopy.payments.refund}
      </button>
    );
  }

  return (
    <form action={refundPaymentAction} className="flex flex-col gap-2">
      <input type="hidden" name="paymentId" value={paymentId} />
      <label htmlFor={`reason-${paymentId}`} className="text-xs text-white/60">
        {adminCopy.payments.refundReason}
      </label>
      <input
        id={`reason-${paymentId}`}
        name="reason"
        type="text"
        required
        minLength={3}
        maxLength={500}
        data-testid="refund-reason"
        className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs outline-none focus:border-white/40"
      />
      <button
        type="submit"
        data-testid="refund-confirm"
        className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-neutral-950"
      >
        {adminCopy.payments.refundConfirm}
      </button>
    </form>
  );
}
