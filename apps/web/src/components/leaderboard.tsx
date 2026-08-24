import type { LeaderboardEntryDto } from "@creator-outdoor/contracts";
import { CreatorCard } from "@/components/creator-card";
import type { RankingTab } from "@/lib/api";
import { copy } from "@/lib/copy";

export type LeaderboardProps = {
  readonly tab: RankingTab;
  readonly entries: readonly LeaderboardEntryDto[];
  readonly unavailable?: boolean;
};

const TABS: ReadonlyArray<{
  readonly id: RankingTab;
  readonly label: string;
  readonly href: string;
}> = [
  { id: "weekly", label: copy.leaderboard.weeklyTab, href: "/#ranking" },
  { id: "all-time", label: copy.leaderboard.allTimeTab, href: "/?ranking=geral#ranking" },
];

export function Leaderboard({ tab, entries, unavailable = false }: LeaderboardProps) {
  return (
    <section id="ranking" aria-label={copy.leaderboard.title} className="scroll-mt-20">
      <div
        role="tablist"
        aria-label={copy.leaderboard.title}
        className="mb-4 flex gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1"
      >
        {TABS.map((item) => {
          const selected = item.id === tab;
          return (
            <a
              key={item.id}
              role="tab"
              aria-selected={selected}
              href={item.href}
              className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-bold transition-colors ${
                selected ? "bg-white text-neutral-950" : "text-white/70 hover:text-white"
              }`}
            >
              {item.label}
            </a>
          );
        })}
      </div>

      {unavailable ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
          {copy.leaderboard.unavailable}
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-white/60">
          {copy.leaderboard.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <CreatorCard key={entry.creator.id} entry={entry} tab={tab} />
          ))}
        </ul>
      )}
    </section>
  );
}
