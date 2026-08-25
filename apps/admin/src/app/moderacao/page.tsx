import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { CreatorModerationCard } from "@/components/creator-moderation-card";
import { fetchModerationQueue } from "@/lib/api";
import { adminCopy } from "@/lib/copy";
import { currentOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

type ModerationPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "REMOVED",
  "OPTOUT_VERIFICATION_PENDING",
  "OPTED_OUT",
] as const;

type Status = (typeof STATUSES)[number];

function resolveStatus(value: string | string[] | undefined): Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as Status)
    : "PENDING_REVIEW";
}

export default async function ModerationPage({ searchParams }: ModerationPageProps) {
  const operator = await currentOperator();
  if (operator === null) {
    redirect("/login");
  }
  const status = resolveStatus((await searchParams)["status"]);
  const queue = await fetchModerationQueue(status);

  return (
    <AdminShell title={adminCopy.moderation.title} operator={operator}>
      <nav className="mb-6 flex flex-wrap gap-2" aria-label={adminCopy.moderation.status}>
        {STATUSES.map((candidate) => (
          <a
            key={candidate}
            href={`/moderacao?status=${candidate}`}
            aria-current={candidate === status ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              candidate === status
                ? "border-white bg-white text-neutral-950"
                : "border-white/15 text-white/70 hover:text-white"
            }`}
          >
            {adminCopy.statusLabels[candidate]}
          </a>
        ))}
      </nav>

      <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h2 className="mb-2 text-sm font-bold">{adminCopy.moderation.checklist.title}</h2>
        <ul className="list-disc pl-5 text-sm text-white/60">
          {adminCopy.moderation.checklist.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {queue.creators.length === 0 ? (
        <p data-testid="queue-empty" className="text-sm text-white/60">
          {adminCopy.moderation.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.creators.map((creator) => (
            <CreatorModerationCard key={creator.id} creator={creator} />
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
