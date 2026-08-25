"use client";

import { useEffect } from "react";
import { adminCopy } from "@/lib/copy";

/**
 * What an operator sees when an administrative action or page fails.
 *
 * This matters more here than on the public site. An operator who approves a
 * creator, or sends money back, and then sees a bare browser error page has no
 * way to tell whether it happened. So the first thing this says is that nothing
 * changed — which is true: every mutation on this surface either completes in a
 * transaction or does not happen, and a failure that reaches here is a failure
 * before the redirect.
 *
 * The digest is Next's identifier for the failure and is the only detail shown.
 * The message and the stack stay on the server, where the log and the error
 * tracker have them; an admin screen is not a place to print a driver error
 * that may carry somebody's address.
 */
export default function AdminErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error("admin_action_failed", error.name);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-black">{adminCopy.error.title}</h1>
      <p className="text-sm text-white/70">{adminCopy.error.body}</p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          data-testid="admin-error-retry"
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-neutral-950"
        >
          {adminCopy.error.retry}
        </button>
        <a
          href="/moderacao"
          className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
        >
          {adminCopy.error.back}
        </a>
      </div>

      {error.digest === undefined ? null : (
        <p data-testid="admin-error-reference" className="font-mono text-xs text-white/40">
          {adminCopy.error.reference(error.digest)}
        </p>
      )}
    </main>
  );
}
