import type { Metadata } from "next";
import { CreatorAvatar } from "@/components/creator-avatar";
import { SiteHeader } from "@/components/site-header";
import { fetchHallOfFame } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatBrl } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: copy.hallOfFame.title,
  description: copy.hallOfFame.subtitle,
  alternates: { canonical: "/hall-da-fama" },
};

const WEEK_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Hall da Fama.
 *
 * Read from the closed weekly snapshots, so a refund landing after a period
 * closed corrects the history rather than leaving a champion whose money went
 * back. Nothing here is a separate record to keep in step.
 */
export default async function HallOfFamePage() {
  const hall = await fetchHallOfFame(30);

  return (
    <>
      <SiteHeader periodEndsAt={null} countdownLabel={null} />
      <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-black text-white sm:text-3xl">{copy.hallOfFame.title}</h1>
          <p className="text-sm text-white/60">{copy.hallOfFame.subtitle}</p>
        </header>

        {hall.champions.length === 0 ? (
          <p data-testid="hall-empty" className="text-sm text-white/60">
            {copy.hallOfFame.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {hall.champions.map((champion) => (
              <li
                key={`${champion.creator.slug}-${champion.periodStartsAt}`}
                data-testid="hall-entry"
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:gap-4 sm:p-4"
              >
                <CreatorAvatar
                  displayName={champion.creator.displayName}
                  avatarUrl={champion.creator.avatarUrl}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/criador/${champion.creator.slug}`}
                    className="truncate text-base font-bold text-white underline-offset-2 hover:underline"
                  >
                    {champion.creator.displayName}
                  </a>
                  <p className="truncate text-xs uppercase tracking-wide text-white/55">
                    {copy.hallOfFame.week} {WEEK_FORMAT.format(new Date(champion.periodStartsAt))}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-amber-300">
                  {formatBrl(champion.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
