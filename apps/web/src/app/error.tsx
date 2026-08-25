"use client";

import { useEffect } from "react";
import { copy } from "@/lib/copy";

/**
 * What a visitor sees when a page fails to render.
 *
 * Without this, Next serves its own bare "a server-side exception has occurred",
 * which tells somebody nothing, offers them nothing, and looks like a different
 * site. The ranking is unaffected by whatever went wrong here, and saying so is
 * the honest thing: the money and the position are safe either way.
 *
 * The digest is Next's own identifier for the failure, shown so somebody
 * reporting the problem can name it. It carries no detail about the fault — the
 * message and the stack stay on the server, where the log and the error tracker
 * already have them.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    // The name only. A message can carry a driver's parameters or an address,
    // and this one is going to a browser console on somebody else's machine.
    console.error("page_render_failed", error.name);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-black text-white">{copy.error.title}</h1>
      <p className="text-sm text-white/70">{copy.error.body}</p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          data-testid="error-retry"
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-neutral-950"
        >
          {copy.error.retry}
        </button>
        <a
          href="/"
          className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
        >
          {copy.error.home}
        </a>
      </div>

      {error.digest === undefined ? null : (
        <p data-testid="error-reference" className="font-mono text-xs text-white/40">
          {copy.error.reference(error.digest)}
        </p>
      )}
    </main>
  );
}
