"use client";

import { useActionState } from "react";
import { type LoginState, signIn } from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

const INITIAL: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="password" className="text-sm font-medium text-white/80">
        {adminCopy.login.passwordLabel}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-base outline-none focus:border-white/40"
      />
      {state.error === null ? null : (
        <p role="alert" data-testid="login-error" className="text-sm text-red-300">
          {state.error === "throttled" ? adminCopy.login.throttled : adminCopy.login.invalid}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-neutral-950 disabled:opacity-60"
      >
        {adminCopy.login.submit}
      </button>
    </form>
  );
}
