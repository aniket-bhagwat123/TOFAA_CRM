"use client";
import { Target, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApprovalsCard } from "@/components/crm/approvals-card";
import { TargetsModal } from "@/components/crm/targets-modal";
import { UserSheet } from "@/components/crm/user-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { StageBadge } from "@/components/ui/stage-badge";
import { useApi } from "@/hooks/use-api";
import { formatDate } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Approval, StageKey } from "@/types/crm";

type Summary = {
  members: { id: string; fullName: string; role: string; open: number; overdue: number; noNextAction: number; meetingsToday: number }[];
  overdueLeads: { leadId: string; ownerName: string; companyName: string; contactName: string; stage: StageKey; nextFollowUp: string }[];
  totals: { open: number; overdue: number; noNextAction: number };
};

export default function TeamPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const router = useRouter();
  const allowed = !!user && isManager(user.role);
  const summary = useApi<Summary>(allowed ? "/team/summary" : null);
  const [adding, setAdding] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const approvals = useApi<Approval[]>(allowed ? "/approvals" : null);

  useEffect(() => { if (user && !allowed) router.replace("/today"); }, [user, allowed, router]);
  if (!allowed) return null;

  const stat = (label: string, value: number, tone?: string) => (
    <Card className="p-4"><div className="text-xs text-slate-500">{label}</div><div className={cn("text-2xl font-semibold", tone)}>{value}</div></Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Team"
        description="Who has open work, and what is overdue."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setTargetsOpen(true)}><Target className="h-4 w-4" /> Targets</Button>
            {user?.role === "sales_manager" && <Button variant="secondary" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add executive</Button>}
          </div>
        }
      />
      {summary.loading && !summary.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {summary.error && !summary.data && <StateView kind="error" message={summary.error} onRetry={() => void summary.reload()} />}
      {summary.data && (
        <>
          {approvals.data && <ApprovalsCard items={approvals.data} onChanged={() => void approvals.reload()} />}
          <div className="grid grid-cols-3 gap-3">
            {stat("Open deals", summary.data.totals.open)}
            {stat("Overdue follow-ups", summary.data.totals.overdue, summary.data.totals.overdue ? "text-red-600" : "")}
            {stat("No next action", summary.data.totals.noNextAction, summary.data.totals.noNextAction ? "text-amber-600" : "")}
          </div>
          {summary.data.members.length === 0 ? (
            <EmptyState title="No team members yet" hint="Add an executive to get started." action={user?.role === "sales_manager" ? <Button onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add executive</Button> : undefined} />
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr><th className="p-3">Name</th><th className="p-3">Open</th><th className="p-3">Overdue</th><th className="p-3">No next action</th><th className="p-3">Meetings today</th></tr>
                </thead>
                <tbody>
                  {summary.data.members.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="p-3 font-medium">{m.fullName}</td>
                      <td className="p-3">{m.open}</td>
                      <td className={cn("p-3", m.overdue ? "font-semibold text-red-600" : "")}>{m.overdue}</td>
                      <td className={cn("p-3", m.noNextAction ? "font-semibold text-amber-600" : "")}>{m.noNextAction}</td>
                      <td className="p-3">{m.meetingsToday}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {summary.data.overdueLeads.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Overdue follow-ups</h2>
              {summary.data.overdueLeads.map((l) => (
                <Link key={l.leadId} href={`/leads/${l.leadId}`} className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.companyName}</div>
                    <div className="truncate text-xs text-slate-500">{l.contactName} · {l.ownerName} · due {formatDate(l.nextFollowUp)}</div>
                  </div>
                  <StageBadge stage={l.stage} />
                </Link>
              ))}
            </section>
          )}
        </>
      )}
      <TargetsModal open={targetsOpen} onClose={() => setTargetsOpen(false)} onSaved={() => void approvals.reload()} />
      <UserSheet open={adding} roles={["sales_executive"]} managers={[]} onClose={() => setAdding(false)} onDone={() => void summary.reload()} />
    </div>
  );
}
