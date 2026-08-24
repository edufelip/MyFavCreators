import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { copy } from "@/lib/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.unsubscribe.title,
  robots: { index: false, follow: false },
};

type UnsubscribePageProps = { readonly params: Promise<{ readonly token: string }> };

/**
 * The page an unsubscribe link lands on.
 *
 * It confirms rather than acting on load: mail clients and security scanners
 * prefetch links, and a GET that unsubscribed would unsubscribe people who
 * never clicked anything. The actual change is a POST, which is also what
 * RFC 8058 one-click sends.
 */
export default async function UnsubscribePage({ params }: UnsubscribePageProps) {
  const { token } = await params;

  return (
    <>
      <SiteHeader periodEndsAt={null} countdownLabel={null} />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-16">
        <h1 className="text-2xl font-black text-white">{copy.unsubscribe.title}</h1>
        <p className="text-sm text-white/70">{copy.unsubscribe.intro}</p>
        <UnsubscribeForm token={token} />
      </main>
    </>
  );
}
