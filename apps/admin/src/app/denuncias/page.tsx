import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { resolveReportAction } from "@/lib/actions";
import { fetchReports } from "@/lib/api";
import { adminCopy } from "@/lib/copy";
import { currentOperator } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const operator = await currentOperator();
  if (operator === null) {
    redirect("/login");
  }
  const { reports } = await fetchReports();

  return (
    <AdminShell title={adminCopy.reports.title} operator={operator}>
      {reports.length === 0 ? (
        <p data-testid="reports-empty" className="text-sm text-white/60">
          {adminCopy.reports.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <li
              key={report.id}
              data-testid="report-row"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">/{report.creatorSlug}</p>
                <p className="text-sm text-white/70">{report.reason}</p>
                {report.details === null ? null : (
                  <p className="mt-1 text-sm text-white/60">{report.details}</p>
                )}
                <p className="mt-1 text-xs text-white/55">
                  {new Date(report.createdAt).toLocaleString("pt-BR")}
                </p>
              </div>
              <form action={resolveReportAction}>
                <input type="hidden" name="reportId" value={report.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm font-bold text-white/80"
                >
                  {adminCopy.reports.resolve}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
