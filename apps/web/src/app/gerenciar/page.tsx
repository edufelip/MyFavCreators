import { webConfig } from "@creator-outdoor/config/web";
import type { Metadata } from "next";
import { CreatorManagePanel } from "@/components/creator-manage-panel";
import { SiteHeader } from "@/components/site-header";
import { copy } from "@/lib/copy";
import { currentDashboard } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.manage.title,
  robots: { index: false, follow: false },
};

/**
 * A claimed creator's own view.
 *
 * Behind an httpOnly management token, never indexed, and deliberately showing
 * the same ranking numbers the public page shows plus the delivery measurement.
 * There is no private score and no second version of the truth: the product's
 * claim is that money is the only signal, and a dashboard that showed something
 * else would undo it.
 */
export default async function ManagePage() {
  const dashboard = await currentDashboard();

  return (
    <>
      <SiteHeader periodEndsAt={null} countdownLabel={null} />
      <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-black text-white">{copy.manage.title}</h1>
        {dashboard === null ? (
          <div data-testid="manage-signed-out" className="flex flex-col items-start gap-3">
            <p className="text-sm text-white/70">{copy.manage.noSession}</p>
            <a href="/" className="text-sm font-semibold text-amber-300 underline">
              {copy.manage.findProfile}
            </a>
          </div>
        ) : (
          <CreatorManagePanel dashboard={dashboard} webOrigin={webConfig.webOrigin} />
        )}
      </main>
    </>
  );
}
