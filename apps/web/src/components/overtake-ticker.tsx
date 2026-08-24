import type { RankEventListDto } from "@creator-outdoor/contracts";
import { copy } from "@/lib/copy";
import { formatRelativeTime } from "@/lib/format";

export type OvertakeTickerProps = {
  readonly events: RankEventListDto | null;
  readonly now: Date;
};

/**
 * Recent movement in the ranking.
 *
 * Secondary data by design: it is written after a payment commits, so a missing
 * line means the ticker lost an entry, never that a ranking is wrong.
 */
export function OvertakeTicker({ events, now }: OvertakeTickerProps) {
  if (events === null || events.events.length === 0) {
    return null;
  }

  return (
    <section aria-label={copy.ticker.title} data-testid="overtake-ticker">
      <h2 className="mb-3 text-lg font-black tracking-tight text-white">{copy.ticker.title}</h2>
      <ul className="flex flex-col gap-1.5">
        {events.events.map((event) => {
          const elapsed = formatRelativeTime(new Date(event.createdAt), now);
          return (
            <li key={event.id} data-testid="ticker-entry" className="text-sm text-white/70">
              {event.passedCreatorSlug === null
                ? copy.ticker.overtake(event.creatorSlug, event.fromRank, event.toRank, elapsed)
                : copy.ticker.passed(event.creatorSlug, event.passedCreatorSlug, elapsed)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
