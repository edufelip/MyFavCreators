import { createSessionToken, readSessionToken } from "@creator-outdoor/config";
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
      secure: adminConfig.isProduction,
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
 */
export async function currentOperator(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token === undefined) {
    return null;
  }
  return readSessionToken(token, adminConfig.adminSessionSecret)?.subject ?? null;
}

export async function hasAdminSession(): Promise<boolean> {
  return (await currentOperator()) !== null;
}
