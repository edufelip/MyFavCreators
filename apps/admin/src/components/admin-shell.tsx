import type { ReactNode } from "react";
import { signOut } from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

export type AdminShellProps = {
  readonly title: string;
  /** Who is signed in. Shown so a shared screen cannot hide whose account it is. */
  readonly operator: string;
  readonly children: ReactNode;
};

export function AdminShell({ title, operator, children }: AdminShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-white/10 bg-neutral-900/60">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-sm font-black uppercase tracking-[0.16em]">{adminCopy.brand}</span>
          <nav className="flex gap-4 text-sm">
            <a href="/moderacao" className="text-white/70 hover:text-white">
              {adminCopy.nav.moderation}
            </a>
            <a href="/denuncias" className="text-white/70 hover:text-white">
              {adminCopy.nav.reports}
            </a>
            <a href="/pagamentos" className="text-white/70 hover:text-white">
              {adminCopy.nav.payments}
            </a>
            <a href="/auditoria" className="text-white/70 hover:text-white">
              {adminCopy.nav.audit}
            </a>
          </nav>
          <span data-testid="admin-operator" className="ml-auto text-sm text-white/50">
            {operator}
          </span>
          <form action={signOut}>
            <button type="submit" className="text-sm text-white/60 underline hover:text-white">
              {adminCopy.nav.signOut}
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-black tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}
