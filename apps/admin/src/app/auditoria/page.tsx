import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { fetchAuditLogs } from "@/lib/api";
import { adminCopy } from "@/lib/copy";
import { hasAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  if (!(await hasAdminSession())) {
    redirect("/login");
  }
  const { entries } = await fetchAuditLogs();

  return (
    <AdminShell title={adminCopy.audit.title}>
      {entries.length === 0 ? (
        <p data-testid="audit-empty" className="text-sm text-white/60">
          {adminCopy.audit.empty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="py-2 pr-4">{adminCopy.audit.when}</th>
                <th className="py-2 pr-4">{adminCopy.audit.actor}</th>
                <th className="py-2 pr-4">{adminCopy.audit.action}</th>
                <th className="py-2">{adminCopy.audit.target}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} data-testid="audit-row" className="border-t border-white/10">
                  <td className="py-2 pr-4 text-white/60">
                    {new Date(entry.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-4">{entry.actor}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{entry.action}</td>
                  <td className="py-2 text-white/60">
                    {entry.targetType}/{entry.targetId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
