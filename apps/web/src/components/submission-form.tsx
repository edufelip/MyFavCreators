"use client";

import { useActionState } from "react";
import { submitCreatorAction } from "@/app/enviar/actions";
import { INITIAL_SUBMISSION_STATE } from "@/app/enviar/state";
import { copy } from "@/lib/copy";

export function SubmissionForm() {
  const [state, formAction, pending] = useActionState(
    submitCreatorAction,
    INITIAL_SUBMISSION_STATE,
  );
  const succeeded = state.outcome === "SUBMITTED";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="url" className="text-sm font-semibold text-white/80">
        {copy.submission.urlLabel}
      </label>
      <input
        id="url"
        name="url"
        type="url"
        inputMode="url"
        autoComplete="url"
        required
        placeholder={copy.submission.urlPlaceholder}
        aria-describedby="url-hint"
        className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white outline-none focus:border-amber-300"
      />
      <p id="url-hint" className="text-xs text-white/40">
        {copy.submission.urlHint}
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-amber-400 px-5 py-3 text-base font-black uppercase tracking-wide text-neutral-950 disabled:opacity-60"
      >
        {pending ? copy.submission.submitting : copy.submission.submit}
      </button>

      {state.message === null ? null : (
        <p
          role="status"
          data-testid="submission-result"
          data-outcome={state.outcome ?? "ERROR"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            succeeded
              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
              : "border-white/15 bg-white/5 text-white/80"
          }`}
        >
          {state.message}
          {state.creatorSlug === null ? null : (
            <>
              {" "}
              <a href={`/criador/${state.creatorSlug}`} className="font-semibold underline">
                {copy.submission.seeProfile}
              </a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
