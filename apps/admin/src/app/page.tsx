import { adminCopy } from "@/lib/copy";

/**
 * Phase 1 placeholder.
 *
 * Phase 2 replaces this with the authenticated moderation product. The
 * architecture it must preserve is already fixed: the browser talks only to
 * this Next.js server, the administrator session lives in a secure HttpOnly
 * cookie here, and every mutation is a server-to-server call into the API's
 * internal admin surface authenticated with ADMIN_API_SECRET. That secret is
 * server-only and never reaches the browser.
 */
export default function AdminHomePage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-2xl font-black tracking-tight text-white">
        {adminCopy.placeholder.title}
      </h1>
      <p className="text-sm text-white/70">{adminCopy.placeholder.body}</p>
      <p className="text-sm text-white/50">{adminCopy.placeholder.boundary}</p>
    </main>
  );
}
