"use client";

import { useActionState } from "react";
import { type LoginState, signIn } from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

const INITIAL: LoginState = { error: null };

/**
 * A message per failure, looked up rather than chained.
 *
 * A ternary falls through to "wrong password" for anything it does not name, so
 * a new outcome that nobody wired up here would show the operator a confident
 * and wrong explanation. An unknown key shows the generic message instead,
 * which is at least true.
 */
const LOGIN_ERRORS: Readonly<Record<string, string>> = {
  throttled: adminCopy.login.throttled,
  invalid: adminCopy.login.invalid,
  "published-credentials": adminCopy.login.publishedCredentials,
};

const FIELD =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-base outline-none focus:border-white/40";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor="operator" className="text-sm font-medium text-white/80">
        {adminCopy.login.operatorLabel}
      </label>
      <input
        id="operator"
        name="operator"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        className={FIELD}
      />

      <label htmlFor="password" className="text-sm font-medium text-white/80">
        {adminCopy.login.passwordLabel}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className={FIELD}
      />

      <label htmlFor="code" className="text-sm font-medium text-white/80">
        {adminCopy.login.codeLabel}
      </label>
      <input
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        aria-describedby="code-help"
        className={FIELD}
      />
      <p id="code-help" className="text-xs text-white/50">
        {adminCopy.login.codeHelp}
      </p>

      {state.error === null ? null : (
        <p role="alert" data-testid="login-error" className="text-sm text-red-300">
          {LOGIN_ERRORS[state.error] ?? adminCopy.login.invalid}
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
