import { Countdown } from "@/components/countdown";
import { copy } from "@/lib/copy";

export type SiteHeaderProps = {
  readonly periodEndsAt: string | null;
  readonly countdownLabel: string | null;
};

/**
 * Logo, ranking link and the weekly countdown. Deliberately not a dashboard
 * navigation: the product has to be understandable in about five seconds.
 */
export function SiteHeader({ periodEndsAt, countdownLabel }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
        <a href="/" className="text-sm font-black uppercase tracking-[0.18em] text-white">
          {copy.brand.name}
        </a>
        <a
          href="/#ranking"
          className="text-sm font-medium text-white/70 transition-colors hover:text-white"
        >
          {copy.nav.ranking}
        </a>
        <a
          href="/enviar"
          className="text-sm font-medium text-white/70 transition-colors hover:text-white"
        >
          {copy.nav.submit}
        </a>
        <a
          href="/regras"
          className="text-sm font-medium text-white/70 transition-colors hover:text-white"
        >
          {copy.nav.rules}
        </a>
        <div className="ml-auto basis-full sm:basis-auto">
          {periodEndsAt !== null && countdownLabel !== null ? (
            <Countdown endsAt={periodEndsAt} initialLabel={countdownLabel} />
          ) : null}
        </div>
      </div>
    </header>
  );
}
