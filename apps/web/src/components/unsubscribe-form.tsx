"use client";

import { useActionState } from "react";
import { unsubscribeAction } from "@/app/descadastrar/[token]/actions";
import { INITIAL_UNSUBSCRIBE_STATE, type UnsubscribeState } from "@/app/descadastrar/[token]/state";
import { copy } from "@/lib/copy";

export type UnsubscribeFormProps = { readonly token: string };

/**
 * The confirmation an unsubscribe link asks for.
 *
 * A button rather than an automatic action, because mail clients prefetch
 * links: unsubscribing on load would unsubscribe people who never clicked.
 */
export function UnsubscribeForm({ token }: UnsubscribeFormProps) {
  const [state, formAction, pending] = useActionState<UnsubscribeState, FormData>(
    unsubscribeAction,
    INITIAL_UNSUBSCRIBE_STATE,
  );

  if (state.status === "done") {
    return (
      <div data-testid="unsubscribe-result" data-status="done" className="flex flex-col gap-3">
        <p className="text-sm text-white/80">{copy.unsubscribe.body}</p>
        <a href="/" className="text-sm font-semibold text-amber-300 underline">
          {copy.unsubscribe.backToRanking}
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-start gap-3">
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        data-testid="unsubscribe-submit"
        className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 disabled:opacity-60"
      >
        {copy.unsubscribe.confirm}
      </button>
      {state.status === "error" ? (
        <p
          role="alert"
          data-testid="unsubscribe-result"
          data-status="error"
          className="text-sm text-red-300"
        >
          {copy.unsubscribe.unavailable}
        </p>
      ) : null}
    </form>
  );
}
