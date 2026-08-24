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
 * credential: the API secret and the password hash stay on the server.
 */
export async function startAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(
    SESSION_COOKIE,
    createSessionToken(adminConfig.adminSessionSecret, SESSION_TTL_SECONDS),
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

export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token !== undefined && readSessionToken(token, adminConfig.adminSessionSecret) !== null;
}
