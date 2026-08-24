import type { AdminCreatorDto } from "@creator-outdoor/contracts";
import {
  approveCreatorAction,
  rejectCreatorAction,
  removeCreatorAction,
  restoreCreatorAction,
} from "@/lib/actions";
import { adminCopy } from "@/lib/copy";

const REJECTION_REASONS = [
  "NOT_PUBLIC_OR_PROFESSIONAL",
  "MINOR",
  "DUPLICATE",
  "MALICIOUS_URL",
  "IMPERSONATION",
  "INVALID_PROFILE",
  "OTHER",
] as const;

const FIELD_CLASS =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40";

export function CreatorModerationCard({ creator }: { readonly creator: AdminCreatorDto }) {
  const isPending = creator.moderationStatus === "PENDING_REVIEW";
  const isApproved = creator.moderationStatus === "APPROVED";
  const isRestorable =
    creator.moderationStatus === "REJECTED" || creator.moderationStatus === "REMOVED";

  return (
    <li
      data-testid="moderation-card"
      data-creator-slug={creator.slug}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">{creator.displayName}</h2>
        <span className="text-sm text-white/50">/{creator.slug}</span>
        <span
          data-testid="moderation-status"
          className="ml-auto rounded-md border border-white/15 px-2 py-0.5 text-xs font-semibold text-white/70"
        >
          {adminCopy.statusLabels[creator.moderationStatus]}
        </span>
      </header>

      <dl className="mb-4 grid gap-1 text-sm text-white/70 sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold">{adminCopy.moderation.links}: </dt>
          <dd className="inline">
            {creator.links.map((link) => `${link.platform} ${link.handle}`).join(", ")}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">{adminCopy.moderation.submittedAt}: </dt>
          <dd className="inline">{new Date(creator.createdAt).toLocaleString("pt-BR")}</dd>
        </div>
      </dl>

      {isPending ? (
        <form action={approveCreatorAction} className="mb-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="creatorId" value={creator.id} />
          <label className="text-xs text-white/60">
            {adminCopy.moderation.displayName}
            <input name="displayName" defaultValue={creator.displayName} className={FIELD_CLASS} />
          </label>
          <label className="text-xs text-white/60">
            {adminCopy.moderation.avatarUrl}
            <input
              name="avatarUrl"
              defaultValue={creator.avatarUrl ?? ""}
              className={FIELD_CLASS}
            />
          </label>
          <label className="text-xs text-white/60 sm:col-span-2">
            {adminCopy.moderation.bio}
            <input name="bio" defaultValue={creator.bio ?? ""} className={FIELD_CLASS} />
          </label>
          <label className="text-xs text-white/60">
            {adminCopy.moderation.category}
            <input
              name="categorySlug"
              defaultValue={creator.category.slug}
              className={FIELD_CLASS}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              data-testid="approve-button"
              className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-neutral-950"
            >
              {adminCopy.moderation.approve}
            </button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {isPending || isApproved ? (
          <form action={rejectCreatorAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="creatorId" value={creator.id} />
            <label className="text-xs text-white/60">
              {adminCopy.moderation.rejectionReason}
              <select name="reason" className={FIELD_CLASS} defaultValue="INVALID_PROFILE">
                {REJECTION_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {adminCopy.rejectionReasonLabels[reason]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              data-testid="reject-button"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white/80"
            >
              {adminCopy.moderation.reject}
            </button>
          </form>
        ) : null}

        {isPending || isApproved || creator.moderationStatus === "OPTOUT_VERIFICATION_PENDING" ? (
          <form action={removeCreatorAction} className="flex items-end">
            <input type="hidden" name="creatorId" value={creator.id} />
            <button
              type="submit"
              data-testid="remove-button"
              className="rounded-lg border border-red-400/40 px-4 py-2 text-sm font-bold text-red-200"
            >
              {adminCopy.moderation.remove}
            </button>
          </form>
        ) : null}

        {isRestorable ? (
          <form action={restoreCreatorAction} className="flex items-end">
            <input type="hidden" name="creatorId" value={creator.id} />
            <button
              type="submit"
              data-testid="restore-button"
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-bold text-white/80"
            >
              {adminCopy.moderation.restore}
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
