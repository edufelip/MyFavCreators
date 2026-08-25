"use client";

import type { CreatorDashboardDto } from "@creator-outdoor/contracts";
import { useActionState } from "react";
import {
  setNotificationsAction,
  signOutManageAction,
  updateProfileAction,
} from "@/app/gerenciar/actions";
import { INITIAL_MANAGE_STATE } from "@/app/gerenciar/state";
import { copy } from "@/lib/copy";
import { formatBrl } from "@/lib/format";

const PANEL_CLASS = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
const FIELD_CLASS =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";

export type CreatorManagePanelProps = {
  readonly dashboard: CreatorDashboardDto;
  /** Absolute, because the snippet is pasted onto somebody else's page. */
  readonly webOrigin: string;
};

/**
 * Everything a claimed creator can see and change about their own profile.
 *
 * The editable set is deliberately narrow — the bio and the category. The name
 * and the platform links are how a visitor tells one profile from another, and
 * letting a claimant rewrite them would turn a claimed profile into a way to
 * impersonate somebody else after the fact.
 */
export function CreatorManagePanel({ dashboard, webOrigin }: CreatorManagePanelProps) {
  const [profileState, saveProfile, savingProfile] = useActionState(
    updateProfileAction,
    INITIAL_MANAGE_STATE,
  );
  const [notifyState, saveNotifications, savingNotifications] = useActionState(
    setNotificationsAction,
    INITIAL_MANAGE_STATE,
  );

  const ctr =
    dashboard.clickThroughRate === null
      ? copy.manage.ctrUnavailable
      : `${(dashboard.clickThroughRate * 100).toFixed(1)}%`;
  const embedSnippet =
    `<a href="${webOrigin}/criador/${dashboard.creatorSlug}">` +
    `<img src="${webOrigin}/api/badge/${dashboard.creatorSlug}.svg" ` +
    `alt="${dashboard.displayName} no Creator Outdoor" width="320" height="80" /></a>`;

  return (
    <div
      data-testid="manage-panel"
      data-creator-slug={dashboard.creatorSlug}
      className="flex flex-col gap-6"
    >
      <section className={PANEL_CLASS} aria-label={copy.manage.ranking}>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          {copy.manage.ranking}
        </h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={copy.manage.weeklyRank}
            value={dashboard.weeklyRank === null ? "—" : `#${dashboard.weeklyRank}`}
            testId="manage-weekly-rank"
          />
          <Stat
            label={copy.manage.weeklyTotal}
            value={formatBrl(dashboard.weeklyAmountCents)}
            testId="manage-weekly-amount"
          />
          <Stat
            label={copy.manage.lifetimeTotal}
            value={formatBrl(dashboard.allTimeAmountCents)}
            testId="manage-lifetime-amount"
          />
          <Stat
            label={copy.manage.supporters}
            value={String(dashboard.supporterCount)}
            testId="manage-supporters"
          />
        </dl>
        {dashboard.championWeeks === 0 ? null : (
          <p data-testid="manage-champion-weeks" className="mt-3 text-sm font-bold text-amber-300">
            {copy.hallOfFame.championBadge(dashboard.championWeeks)}
          </p>
        )}
      </section>

      <section className={PANEL_CLASS} aria-label={copy.manage.delivery}>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          {copy.manage.delivery}
        </h2>
        <dl className="grid grid-cols-3 gap-3">
          <Stat
            label={copy.manage.impressions}
            value={dashboard.impressions.toLocaleString("pt-BR")}
            testId="manage-impressions"
          />
          <Stat
            label={copy.manage.clicks}
            value={dashboard.outboundClicks.toLocaleString("pt-BR")}
            testId="manage-clicks"
          />
          <Stat label={copy.manage.ctr} value={ctr} testId="manage-ctr" />
        </dl>
      </section>

      <section className={PANEL_CLASS} aria-label={copy.manage.title}>
        <form action={saveProfile} className="flex flex-col gap-3">
          <label htmlFor="bio" className="text-xs text-white/60">
            {copy.manage.bio}
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            maxLength={500}
            defaultValue={dashboard.bio ?? ""}
            data-testid="manage-bio"
            className={FIELD_CLASS}
          />
          <label htmlFor="categorySlug" className="text-xs text-white/60">
            {copy.manage.category}
          </label>
          <input
            id="categorySlug"
            name="categorySlug"
            defaultValue={dashboard.categorySlug}
            data-testid="manage-category"
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            disabled={savingProfile}
            data-testid="manage-save"
            className="self-start rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 disabled:opacity-60"
          >
            {copy.manage.save}
          </button>
          {profileState.message === null ? null : (
            <p role="status" data-testid="manage-profile-result" className="text-sm text-white/70">
              {profileState.message}
            </p>
          )}
        </form>
      </section>

      <section className={PANEL_CLASS} aria-label={copy.manage.notifications}>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          {copy.manage.notifications}
        </h2>
        <form action={saveNotifications} className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="notifyDethrone"
              defaultChecked={dashboard.notifyDethrone}
              data-testid="manage-notify"
              className="h-4 w-4"
            />
            {copy.manage.notifyDethrone}
          </label>
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input
              type="checkbox"
              name="notifyWeeklyRecap"
              defaultChecked={dashboard.notifyWeeklyRecap}
              data-testid="manage-notify-recap"
              className="h-4 w-4"
            />
            {copy.manage.notifyWeeklyRecap}
          </label>
          <label htmlFor="notifyEmail" className="text-xs text-white/60">
            {copy.manage.notifyEmail}
          </label>
          <input
            id="notifyEmail"
            name="email"
            type="email"
            maxLength={254}
            data-testid="manage-notify-email"
            className={FIELD_CLASS}
          />
          <button
            type="submit"
            disabled={savingNotifications}
            data-testid="manage-notify-save"
            className="self-start rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white/80 disabled:opacity-60"
          >
            {copy.manage.save}
          </button>
          {notifyState.message === null ? null : (
            <p role="status" data-testid="manage-notify-result" className="text-sm text-white/70">
              {notifyState.message}
            </p>
          )}
        </form>
      </section>

      <section className={PANEL_CLASS} aria-label={copy.manage.embed}>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/60">
          {copy.manage.embed}
        </h2>
        <p className="mb-2 text-sm text-white/60">{copy.manage.embedHelp}</p>
        <code
          data-testid="manage-embed"
          className="block select-all break-all rounded-lg bg-black/40 p-3 font-mono text-xs text-white/80"
        >
          {embedSnippet}
        </code>
      </section>

      <form action={signOutManageAction}>
        <button
          type="submit"
          data-testid="manage-sign-out"
          className="text-sm font-semibold text-white/60 underline"
        >
          {copy.manage.signOut}
        </button>
      </form>
    </div>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-white/55">{label}</dt>
      <dd data-testid={testId} className="mt-1 text-lg font-black tabular-nums text-white">
        {value}
      </dd>
    </div>
  );
}
