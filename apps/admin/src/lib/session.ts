import { createSessionToken, findOperator, readSessionToken } from "@creator-outdoor/config";
import { adminConfig } from "@creator-outdoor/config/admin";
import { cookies } from "next/headers";

const SESSION_COOKIE = "co_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/**
 * The administrator browser session.
 *
 * apps/admin owns it. The cookie is HttpOnly so no script can read it, Secure
 * in production, and SameSite=Strict because nothing outside this app ever
 * needs to navigate into it with the session attached. It carries no
 * credential: the API secret and the operator password hashes stay on the
 * server.
 *
 * What it does carry, inside the signature, is *which operator* it belongs to.
 * That is what lets the audit log name a person, and it is signed rather than
 * stored client-side-editable precisely because the name is the part somebody
 * would want to change.
 */
export async function startAdminSession(operator: string): Promise<void> {
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    createSessionToken(adminConfig.adminSessionSecret, {
      ttlSeconds: SESSION_TTL_SECONDS,
      subject: operator,
    }),
    {
      httpOnly: true,
      secure: adminConfig.cookiesAreSecure,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    },
  );
}

export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The operator this request belongs to, or `null` when there is no valid
 * session. Everything an administrator can do goes through this: an action with
 * nobody behind it is refused rather than attributed to a shared account.
 *
 * The name is checked against the current registry, not only against the
 * signature. The token is stateless and lives eight hours, so verifying the
 * signature alone would leave somebody who had been removed from
 * `ADMIN_OPERATORS` — the documented way to take authority away — approving,
 * removing and refunding until their cookie happened to expire. Removing an
 * operator has to mean removing them now.
 */
export async function currentOperator(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined) {
    return null;
  }
  const subject = readSessionToken(token, adminConfig.adminSessionSecret)?.subject;
  if (subject === undefined) {
    return null;
  }
  return findOperator(adminConfig.adminOperators, subject) === null ? null : subject;
}

export async function hasAdminSession(): Promise<boolean> {
  return (await currentOperator()) !== null;
}
