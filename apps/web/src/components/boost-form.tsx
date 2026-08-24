"use client";

import { useActionState, useId, useState } from "react";
import { startBoostAction } from "@/app/boost/actions";
import { INITIAL_BOOST_FORM_STATE } from "@/app/boost/state";
import { BoostDisclosure } from "@/components/boost-disclosure";
import { copy } from "@/lib/copy";
import { formatBrl } from "@/lib/format";

export type BoostFormCreator = {
  readonly slug: string;
  readonly displayName: string;
  readonly takeFirstPlaceAmountCents: number | null;
};

export type BoostFormProps = {
  readonly creators: readonly BoostFormCreator[];
  /** Preselected creator, used on a creator page where the target is obvious. */
  readonly fixedCreatorSlug?: string;
};

/** The quick values the product offers, before the Take #1 quote is added. */
const QUICK_VALUES = [500, 1_000, 2_500] as const;

const FIELD_CLASS =
  "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white outline-none focus:border-amber-300";

export function BoostForm({ creators, fixedCreatorSlug }: BoostFormProps) {
  const [state, formAction, pending] = useActionState(startBoostAction, INITIAL_BOOST_FORM_STATE);
  const [selectedSlug, setSelectedSlug] = useState(fixedCreatorSlug ?? creators[0]?.slug ?? "");
  const [amountCents, setAmountCents] = useState<number>(QUICK_VALUES[0]);
  const [anonymous, setAnonymous] = useState(false);
  const [origin, setOrigin] = useState<"DIRECT" | "TAKE_FIRST_PLACE">("DIRECT");
  const [showDetails, setShowDetails] = useState(false);
  const fieldId = useId();

  const selected = creators.find((creator) => creator.slug === selectedSlug) ?? creators[0];
  const takeFirstPlace = selected?.takeFirstPlaceAmountCents ?? null;

  return (
    <form action={formAction} className="flex flex-col gap-4" data-testid="boost-form">
      <input type="hidden" name="creatorSlug" value={selectedSlug} />
      <input type="hidden" name="amountCents" value={amountCents} />
      <input type="hidden" name="origin" value={origin} />

      {fixedCreatorSlug === undefined ? (
        <label className="flex flex-col gap-1 text-sm font-semibold text-white/80">
          {copy.boostForm.creatorLabel}
          <select
            value={selectedSlug}
            onChange={(event) => {
              setSelectedSlug(event.target.value);
              setOrigin("DIRECT");
            }}
            data-testid="boost-creator-select"
            className={FIELD_CLASS}
          >
            {creators.map((creator) => (
              <option key={creator.slug} value={creator.slug}>
                {creator.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-white/80">
          {copy.boostForm.amountLabel}
        </legend>
        <div className="flex flex-wrap gap-2">
          {QUICK_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setAmountCents(value);
                setOrigin("DIRECT");
              }}
              aria-pressed={amountCents === value && origin === "DIRECT"}
              data-testid={`boost-amount-${value}`}
              className={`min-w-20 rounded-xl border px-4 py-3 text-base font-bold ${
                amountCents === value && origin === "DIRECT"
                  ? "border-amber-300 bg-amber-300 text-neutral-950"
                  : "border-white/15 text-white/80"
              }`}
            >
              {formatBrl(value)}
            </button>
          ))}

          {takeFirstPlace === null ? null : (
            <button
              type="button"
              onClick={() => {
                setAmountCents(takeFirstPlace);
                setOrigin("TAKE_FIRST_PLACE");
              }}
              aria-pressed={origin === "TAKE_FIRST_PLACE"}
              data-testid="boost-take-first-place"
              className={`rounded-xl border px-4 py-3 text-base font-bold ${
                origin === "TAKE_FIRST_PLACE"
                  ? "border-amber-300 bg-amber-300 text-neutral-950"
                  : "border-white/15 text-white/80"
              }`}
            >
              {copy.cta.takeFirstPlace(formatBrl(takeFirstPlace))}
            </button>
          )}
        </div>

        <label htmlFor={`${fieldId}-custom`} className="mt-1 text-xs text-white/50">
          {copy.boostForm.customAmount}
        </label>
        <input
          id={`${fieldId}-custom`}
          type="number"
          inputMode="numeric"
          min={5}
          step={1}
          value={Math.round(amountCents / 100)}
          onChange={(event) => {
            const reais = Number.parseInt(event.target.value, 10);
            setAmountCents(Number.isSafeInteger(reais) && reais > 0 ? reais * 100 : 0);
            setOrigin("DIRECT");
          }}
          data-testid="boost-custom-amount"
          className={FIELD_CLASS}
        />
      </fieldset>

      <button
        type="button"
        onClick={() => setShowDetails((value) => !value)}
        aria-expanded={showDetails}
        data-testid="boost-details-toggle"
        className="self-start text-sm font-semibold text-white/60 underline"
      >
        {copy.boostForm.supporterName}
      </button>

      {showDetails ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-white/60">
            {copy.boostForm.supporterName}
            <input
              name="supporterName"
              maxLength={40}
              disabled={anonymous}
              data-testid="boost-supporter-name"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            {copy.boostForm.supporterMessage}
            <input
              name="supporterMessage"
              maxLength={140}
              disabled={anonymous}
              data-testid="boost-supporter-message"
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="anonymous"
              checked={anonymous}
              onChange={(event) => setAnonymous(event.target.checked)}
              data-testid="boost-anonymous"
              className="h-4 w-4"
            />
            {copy.boostForm.anonymous}
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/60">
            {copy.boostForm.email}
            <input
              name="supporterEmail"
              type="email"
              maxLength={254}
              data-testid="boost-email"
              className={FIELD_CLASS}
            />
            <span className="text-white/40">{copy.boostForm.emailHint}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="checkbox" name="notifyOnDethrone" className="h-4 w-4" />
            {copy.boostForm.notifyOnDethrone}
          </label>
        </div>
      ) : null}

      {/* Mandatory, always visible, never collapsed. */}
      <BoostDisclosure showRankQuoteNote={origin === "TAKE_FIRST_PLACE"} />

      <button
        type="submit"
        disabled={pending || selectedSlug === "" || amountCents <= 0}
        data-testid="boost-submit"
        className="rounded-xl bg-amber-400 px-5 py-4 text-base font-black uppercase tracking-wide text-neutral-950 disabled:opacity-60"
      >
        {pending ? copy.boostForm.submitting : copy.boostForm.submit}
      </button>

      {state.error === null ? null : (
        <p role="alert" data-testid="boost-error" className="text-sm text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}
