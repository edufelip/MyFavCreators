import type { PaymentStatusDto } from "@creator-outdoor/contracts";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { RefundForm } from "@/components/refund-form";
import { fetchPayments } from "@/lib/api";
import { adminCopy } from "@/lib/copy";
import { currentOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUSES = [
  "CREATED",
  "PENDING",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
] as const;

type PaymentsPageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveStatus(value: string | string[] | undefined): PaymentStatusDto | undefined {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? (value as PaymentStatusDto)
    : undefined;
}

/**
 * Money stays an integer number of centavos right up to this line.
 *
 * Formatting is the only place a division by 100 is allowed to happen, and its
 * result is a string that goes straight to the screen — never back into a
 * calculation.
 */
function formatCents(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const operator = await currentOperator();
  if (operator === null) {
    redirect("/login");
  }
  const status = resolveStatus((await searchParams)["status"]);
  const { payments } = await fetchPayments(status);

  return (
    <AdminShell title={adminCopy.payments.title} operator={operator}>
      <nav className="mb-6 flex flex-wrap gap-2" aria-label={adminCopy.payments.filterLabel}>
        <a
          href="/pagamentos"
          aria-current={status === undefined ? "page" : undefined}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status === undefined ? "bg-white text-neutral-950" : "bg-white/10 text-white/70"
          }`}
        >
          {adminCopy.payments.all}
        </a>
        {STATUSES.map((candidate) => (
          <a
            key={candidate}
            href={`/pagamentos?status=${candidate}`}
            aria-current={status === candidate ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status === candidate ? "bg-white text-neutral-950" : "bg-white/10 text-white/70"
            }`}
          >
            {candidate}
          </a>
        ))}
      </nav>

      {payments.length === 0 ? (
        <p data-testid="payments-empty" className="text-sm text-white/60">
          {adminCopy.payments.empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-white/55">
              <tr>
                <th className="py-2 pr-4">{adminCopy.payments.columns.created}</th>
                <th className="py-2 pr-4">{adminCopy.payments.columns.creator}</th>
                <th className="py-2 pr-4 text-right">{adminCopy.payments.columns.amount}</th>
                <th className="py-2 pr-4">{adminCopy.payments.columns.status}</th>
                <th className="py-2 pr-4">{adminCopy.payments.columns.boost}</th>
                <th className="py-2">{adminCopy.payments.refund}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} data-testid="payment-row" className="border-t border-white/10">
                  <td className="py-2 pr-4 text-white/60">
                    {new Date(payment.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-4">{payment.creatorDisplayName ?? "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums" data-testid="payment-amount">
                    {formatCents(payment.amountCents)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs" data-testid="payment-status">
                    {payment.status}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-white/60">
                    {payment.boostStatus ?? "—"}
                  </td>
                  <td className="py-2">
                    {payment.status === "CONFIRMED" ? (
                      <RefundForm paymentId={payment.id} />
                    ) : payment.status === "REFUNDED" ? (
                      <span className="text-xs text-white/50">{adminCopy.payments.refunded}</span>
                    ) : (
                      <span className="text-xs text-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-white/50">{adminCopy.payments.refundHelp}</p>
    </AdminShell>
  );
}
