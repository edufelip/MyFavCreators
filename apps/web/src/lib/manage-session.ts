import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import { cookies } from "next/headers";

/**
 * The management token for a claimed profile.
 *
 * httpOnly, so a script on the page can never read it, and never placed in a
 * URL: a management link in browser history, a referrer header or an access log
 * would hand somebody else the profile. It travels from this server to the API
 * in an Authorization header and nowhere else.
 */
export const MANAGE_COOKIE = "co_manage";

const MANAGE_DAYS = 90;

export async function readManageToken(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(MANAGE_COOKIE)?.value;
  return token !== undefined && token.length >= 20 ? token : null;
}

export async function storeManageToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(MANAGE_COOKIE, token, {
    httpOnly: true,
    secure: webConfig.cookiesAreSecure,
    sameSite: "lax",
    path: "/",
    maxAge: MANAGE_DAYS * 24 * 60 * 60,
  });
}

export async function clearManageToken(): Promise<void> {
  const store = await cookies();
  // Overwritten and expired with the attributes it was set with, rather than
  // only deleted by name: a cookie whose path or flags differ is a cookie the
  // browser keeps, and keeping this one means staying signed in.
  store.set(MANAGE_COOKIE, "", {
    httpOnly: true,
    secure: webConfig.cookiesAreSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  store.delete(MANAGE_COOKIE);
}
