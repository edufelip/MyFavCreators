"use client";

import { useActionState, useState } from "react";
import { type RefundState, refundPaymentAction } from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

/*
 * Here rather than beside the action it initialises. `actions.ts` is a
 * `"use server"` module, and Next may only export async functions from one —
 * a `const` there compiles, typechecks, and fails the production build.
 */
const INITIAL: RefundState = { error: null };

/**
 * Sending money back.
 *
 * Two steps on purpose. A refund is irreversible and moves real money, so the
 * button that starts it is not the button that does it: the operator has to
 * write down why first, and that reason is what the audit log keeps.
 *
 * A failure is shown here rather than on the error page. The API says something
 * different depending on whether the provider was reached at all, and that
 * difference is the whole point — one answer means retry, the other means go
 * and check the provider's panel before you do.
 */
export function RefundForm({ paymentId }: { readonly paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<RefundState, FormData>(
    refundPaymentAction,
    INITIAL,
  );

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
    <form action={formAction} className="flex flex-col gap-2">
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
      {state.error === null ? null : (
        <p role="alert" data-testid="refund-error" className="text-xs text-amber-300">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        data-testid="refund-confirm"
        className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-neutral-950 disabled:opacity-60"
      >
        {adminCopy.payments.refundConfirm}
      </button>
    </form>
  );
}
