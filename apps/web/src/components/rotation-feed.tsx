import type { RotationResponseDto } from "@creator-outdoor/contracts";
import { CreatorAvatar } from "@/components/creator-avatar";
import { copy } from "@/lib/copy";
import { formatBrl, formatHandle } from "@/lib/format";

export type RotationFeedProps = {
  readonly rotation: RotationResponseDto | null;
};

/**
 * *Impulsionados agora*.
 *
 * Shows a fair slice of everyone currently entitled, not the most recently
 * boosted — and says how many are entitled, so the slice is honest about being
 * a slice.
 */
export function RotationFeed({ rotation }: RotationFeedProps) {
  if (rotation === null || rotation.entries.length === 0) {
    return null;
  }

  return (
    <section aria-label={copy.rotation.title} data-testid="rotation-feed">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-black tracking-tight text-white">{copy.rotation.title}</h2>
        <p className="text-xs text-white/40">{copy.rotation.entitlement(rotation.eligibleCount)}</p>
      </div>

      {/* Horizontal on mobile: a marquee, not a second leaderboard. */}
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
        {rotation.entries.map((entry) => (
          <li key={entry.creator.id} data-testid="rotation-card" className="shrink-0">
            <a
              href={`/criador/${entry.creator.slug}`}
              className="flex w-32 flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center hover:border-white/30"
            >
              <CreatorAvatar
                displayName={entry.creator.displayName}
                avatarUrl={entry.creator.avatarUrl}
                size="sm"
              />
              <span className="w-full truncate text-sm font-bold text-white">
                {entry.creator.displayName}
              </span>
              {entry.creator.primaryHandle === null ? null : (
                <span className="w-full truncate text-xs text-white/50">
                  {formatHandle(entry.creator.primaryHandle, entry.creator.primaryPlatform)}
                </span>
              )}
              <span className="text-xs font-semibold tabular-nums text-amber-300">
                {formatBrl(entry.weeklyAmountCents)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
