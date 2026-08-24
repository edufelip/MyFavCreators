"use client";

import { useActionState, useState } from "react";
import {
  reportCreatorAction,
  requestOptOutAction,
  verifyOptOutAction,
} from "@/app/criador/actions";
import { INITIAL_OWNERSHIP_STATE, INITIAL_REPORT_STATE } from "@/app/criador/state";
import { copy } from "@/lib/copy";

const REPORT_REASONS = [
  "IMPERSONATION",
  "NOT_A_PUBLIC_CREATOR",
  "MINOR",
  "MALICIOUS_OR_HARMFUL",
  "WRONG_INFORMATION",
  "OTHER",
] as const;

const PANEL_CLASS = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
const FIELD_CLASS =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";

/**
 * The unclaimed-creator panel.
 *
 * Removal is a two-step proof of control, never a single click: requesting it
 * issues a code, and only the code appearing on the profile completes it.
 */
export function CreatorOwnershipPanel({ slug }: { readonly slug: string }) {
  const [open, setOpen] = useState(false);
  const [ownership, requestAction] = useActionState(requestOptOutAction, INITIAL_OWNERSHIP_STATE);
  const [verification, verifyAction] = useActionState(verifyOptOutAction, INITIAL_OWNERSHIP_STATE);
  const [report, reportAction] = useActionState(reportCreatorAction, INITIAL_REPORT_STATE);

  const challenge = verification.code ?? ownership.code;
  const verified = verification.outcome === "VERIFIED";

  return (
    <section className="flex flex-col gap-3" aria-label={copy.optOut.title}>
      <p className="text-sm text-white/60">{copy.creator.unclaimed}</p>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="ownership-toggle"
        className="self-start rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white/80"
      >
        {copy.optOut.title}
      </button>

      {open ? (
        <div className="flex flex-col gap-4">
          <div className={PANEL_CLASS}>
            <p className="mb-3 text-sm text-white/60">{copy.optOut.intro}</p>

            <ol className="flex flex-col gap-4">
              <li className="flex flex-col gap-2">
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">
                  {copy.optOut.stepOne}
                </p>
                {challenge === null ? (
                  <form action={requestAction}>
                    <input type="hidden" name="slug" value={slug} />
                    <button
                      type="submit"
                      data-testid="opt-out-request"
                      className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-neutral-950"
                    >
                      {copy.optOut.request}
                    </button>
                  </form>
                ) : (
                  <div>
                    <p
                      data-testid="opt-out-code"
                      className="select-all font-mono text-lg font-bold text-amber-300"
                    >
                      {challenge}
                    </p>
                    <p className="mt-1 text-xs text-white/50">
                      {ownership.message ?? verification.message}
                    </p>
                  </div>
                )}
              </li>

              {/*
                Step two stays available even after a reload. People leave to
                edit their profile and come back later, often on another device;
                the open request lives on the server, so the form must not
                depend on a code still being in this component's memory.
              */}
              <li className={verified ? "hidden" : "flex flex-col gap-2"}>
                <p className="text-xs font-bold uppercase tracking-wide text-white/40">
                  {copy.optOut.stepTwo}
                </p>
                <form action={verifyAction} className="flex flex-col gap-2">
                  <input type="hidden" name="slug" value={slug} />
                  <label htmlFor="profileText" className="text-xs text-white/60">
                    {copy.optOut.profileTextLabel}
                  </label>
                  <textarea
                    id="profileText"
                    name="profileText"
                    rows={3}
                    required
                    className={FIELD_CLASS}
                  />
                  <button
                    type="submit"
                    data-testid="opt-out-verify"
                    className="self-start rounded-lg bg-white px-4 py-2 text-sm font-bold text-neutral-950"
                  >
                    {copy.optOut.verify}
                  </button>
                </form>
              </li>
            </ol>

            {verification.outcome === null ? null : (
              <p
                role="status"
                data-testid="opt-out-result"
                data-outcome={verification.outcome}
                className="mt-3 text-sm text-white/80"
              >
                {verification.message}
              </p>
            )}
          </div>

          <div className={PANEL_CLASS}>
            <h2 className="mb-2 text-sm font-bold">{copy.report.title}</h2>
            <form action={reportAction} className="flex flex-col gap-2">
              <input type="hidden" name="slug" value={slug} />
              <label htmlFor="reason" className="text-xs text-white/60">
                {copy.report.reasonLabel}
              </label>
              <select id="reason" name="reason" className={FIELD_CLASS} defaultValue="OTHER">
                {REPORT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {copy.report.reasons[reason]}
                  </option>
                ))}
              </select>
              <label htmlFor="details" className="text-xs text-white/60">
                {copy.report.detailsLabel}
              </label>
              <textarea id="details" name="details" rows={2} className={FIELD_CLASS} />
              <button
                type="submit"
                data-testid="report-submit"
                className="self-start rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white/80"
              >
                {copy.report.submit}
              </button>
              {report.message === null ? null : (
                <p role="status" data-testid="report-result" className="text-sm text-white/70">
                  {report.message}
                </p>
              )}
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
