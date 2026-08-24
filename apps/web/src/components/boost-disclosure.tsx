import { copy } from "@/lib/copy";

export type BoostDisclosureProps = {
  readonly className?: string;
};

/**
 * The mandatory purchase disclosure.
 *
 * It renders its text verbatim and always visibly: it may not be hidden,
 * collapsed, placed behind a tooltip or presented as unreadable fine print.
 * From Phase 3 it must appear on the homepage boost form, the creator page
 * boost area, the PIX checkout screen and the public rules page.
 */
export function BoostDisclosure({ className }: BoostDisclosureProps) {
  return (
    <p
      data-testid="boost-disclosure"
      className={`rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm leading-snug text-amber-100 ${className ?? ""}`}
    >
      {copy.disclosure}
    </p>
  );
}
