import { copy } from "@/lib/copy";

export type BoostDisclosureProps = {
  readonly className?: string;
  /**
   * Set when checkout began from the *Assuma o #1* call to action. The rank
   * quote is calculated against the ranking at that moment and reserves nothing,
   * so the customer is told the position may change before the PIX confirms.
   */
  readonly showRankQuoteNote?: boolean;
};

/**
 * The mandatory purchase disclosure.
 *
 * It renders its text verbatim and always visibly: it may not be hidden,
 * collapsed, placed behind a tooltip or presented as unreadable fine print.
 * It must appear on the homepage boost form, the creator page boost area, the
 * PIX checkout screen and the public rules page.
 */
export function BoostDisclosure({ className, showRankQuoteNote = false }: BoostDisclosureProps) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <p
        data-testid="boost-disclosure"
        className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm leading-snug text-amber-100"
      >
        {copy.disclosure}
      </p>
      {showRankQuoteNote ? (
        <p
          data-testid="rank-quote-disclosure"
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm leading-snug text-white/80"
        >
          {copy.rankQuoteDisclosure}
        </p>
      ) : null}
    </div>
  );
}
