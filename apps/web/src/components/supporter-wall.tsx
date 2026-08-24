import type { TorcidaDto } from "@creator-outdoor/contracts";
import { copy } from "@/lib/copy";
import { formatBrl } from "@/lib/format";

export type SupporterWallProps = {
  readonly torcida: TorcidaDto;
};

/**
 * The Torcida: who bought this creator's prominence.
 *
 * Names and messages are whatever the payer chose to show, and an anonymous
 * entry is rendered as *Anônimo* with no name at all — the API never sends one.
 * Nothing here is a payout, a ranking input or a claim about the creator; it is
 * a record of who put money behind this profile.
 */
export function SupporterWall({ torcida }: SupporterWallProps) {
  const hidden = Math.max(0, torcida.total - torcida.entries.length);

  return (
    <section
      aria-label={copy.torcida.title}
      data-testid="supporter-wall"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-black tracking-tight text-white">{copy.torcida.title}</h2>
        <p className="text-xs uppercase tracking-wide text-white/50">
          {copy.torcida.supporters(torcida.supporterCount)}
        </p>
      </div>

      {torcida.entries.length === 0 ? (
        <p data-testid="supporter-wall-empty" className="text-sm text-white/60">
          {copy.torcida.empty}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {torcida.entries.map((entry) => (
              <li
                key={entry.id}
                data-testid="supporter-entry"
                data-anonymous={entry.anonymous ? "true" : "false"}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">
                    {entry.supporterName ?? copy.torcida.anonymous}
                  </p>
                  {entry.message === null ? null : (
                    <p className="mt-0.5 break-words text-sm text-white/70">{entry.message}</p>
                  )}
                  {entry.boostCount === 1 ? null : (
                    <p className="mt-0.5 text-xs uppercase tracking-wide text-white/40">
                      {copy.torcida.boostCount(entry.boostCount)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-black tabular-nums text-white">
                  {formatBrl(entry.amountCents)}
                </span>
              </li>
            ))}
          </ul>
          {hidden === 0 ? null : (
            <p className="text-xs uppercase tracking-wide text-white/40">
              {copy.torcida.more(hidden)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
