"use client";
import { BadgeCheck, CalendarClock, Hourglass, KanbanSquare, PackageCheck, Target, TrendingUp, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StageBadge } from "@/components/ui/stage-badge";
import { formatDate, STAGE_LABEL } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { StageKey } from "@/types/crm";
import { Bars, Empty, Section, Tile } from "./widgets";

export type CompanyData = {
  members: { id: string; fullName: string; role: string; open: number; overdue: number; noNextAction: number; meetingsToday: number }[];
  overdueLeads: { leadId: string; ownerName: string; companyName: string; contactName: string; stage: StageKey; nextFollowUp: string }[];
  stuckLeads?: { leadId: string; ownerName: string; companyName: string; stage: StageKey; since: string; value: number; days: number }[];
  totals: { open: number; overdue: number; noNextAction: number };
  pipeline?: { value: number; weighted: number; count: number; byStage?: { stage: StageKey; count: number; value: number }[] } | null;
  target?: { month: string; target: number; won: number; progress: number | null; people: number } | null;
  approvals?: number;
  // Superadmin only
  payments?: { waiting: { count: number; amount: number }; partial: { count: number; outstanding: number }; confirmedThisMonth: { count: number; amount: number } } | null;
  orders?: Record<"new" | "production" | "quality_check" | "dispatched" | "delivered", number> | null;
};

const ROLE: Record<string, string> = { sales_manager: "Manager", admin: "Admin", kam: "KAM" };
const ORDER_LABEL: [keyof NonNullable<CompanyData["orders"]>, string][] = [
  ["new", "Not started"], ["production", "Production"], ["quality_check", "Quality check"], ["dispatched", "Dispatched"], ["delivered", "Delivered"],
];

/** Managers and the Superadmin: the whole company. The Superadmin also sees payments and orders. */
export function CompanyDashboard({ d, admin }: { d: CompanyData; admin: boolean }) {
  return (
    <div className="space-y-5">
      {!!d.approvals && (
        <Link href="/approvals" className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100">
          <span className="flex items-center gap-2 font-medium"><BadgeCheck className="h-4 w-4" /> {d.approvals} {d.approvals === 1 ? "item waits" : "items wait"} for approval</span>
          <span className="text-xs font-semibold">Open Approvals →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pipeline value" value={inrShort(d.pipeline?.value ?? 0)} hint={`${d.pipeline?.count ?? d.totals.open} open deals`} icon={KanbanSquare} href="/leads" />
        <Tile label="Weighted forecast" value={inrShort(d.pipeline?.weighted ?? 0)} hint="Value × stage probability" icon={TrendingUp} href="/reports" />
        <Tile label="Overdue follow-ups" value={String(d.totals.overdue)} hint={`${d.totals.noNextAction} with no next action`} icon={CalendarClock} tone={d.totals.overdue ? "text-red-600" : ""} href="/follow-ups" />
        <Tile label="Stuck deals" value={String(d.stuckLeads?.length ?? 0)} hint={d.stuckLeads?.length ? `No progress in ${d.stuckLeads[0].days}+ days` : "None"} icon={Hourglass} tone={d.stuckLeads?.length ? "text-amber-600" : ""} />
      </div>

      {admin && (d.payments || d.orders) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {d.payments && (
            <Section title="Payments" icon={Wallet} href="/payments" linkLabel="Payments">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Waiting", inrShort(d.payments.waiting.amount), `${d.payments.waiting.count} invoices`, d.payments.waiting.count ? "text-amber-600" : ""],
                  ["Part-paid due", inrShort(d.payments.partial.outstanding), `${d.payments.partial.count} invoices`, ""],
                  ["This month", inrShort(d.payments.confirmedThisMonth.amount), `${d.payments.confirmedThisMonth.count} received`, "text-emerald-600"]].map(([label, value, hint, tone]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-2.5">
                    <div className={cn("text-lg font-semibold tabular-nums text-slate-900", tone)}>{value}</div>
                    <div className="text-[12px] text-slate-500">{label} · {hint}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {d.orders && (
            <Section title="Orders by delivery step" icon={PackageCheck} href="/orders" linkLabel="Orders">
              <Bars format={(n) => String(n)} empty="No orders yet." rows={ORDER_LABEL.map(([k, label]) => ({ key: k, label, value: d.orders![k] ?? 0 }))} />
            </Section>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Pipeline by stage" icon={KanbanSquare} href="/reports" linkLabel="Reports">
          <Bars format={inrShort} empty="No open deals with a value." rows={(d.pipeline?.byStage ?? []).map((s) => ({ key: s.stage, label: STAGE_LABEL[s.stage] ?? s.stage, value: s.value, hint: `${s.count} ${s.count === 1 ? "deal" : "deals"}` }))} />
        </Section>

        {d.target && (
          <Section title={`Target vs achieved · ${d.target.month}`} icon={Target}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-500">
              <span><b className="text-slate-900">{inr(d.target.won)}</b> of {d.target.target ? inr(d.target.target) : "no target set"}</span>
              {d.target.progress != null && <span className="font-semibold text-brand">{d.target.progress}%</span>}
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(d.target.progress ?? 0, 100)}%` }} />
            </div>
            {!d.target.target && <p className="text-xs text-slate-500">Set monthly targets for KAMs in {admin ? "Users → Monthly targets" : "Targets (top right)"}.</p>}
          </Section>
        )}
      </div>

      {d.members.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center gap-2 px-4 pt-4 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-brand" /> People</div>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="p-3">Name</th><th className="p-3">Open</th><th className="p-3">Overdue</th><th className="p-3">No next action</th><th className="p-3">Meetings today</th></tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{m.fullName} <span className="ml-1 text-xs font-normal text-slate-400">{ROLE[m.role] ?? ""}</span></td>
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

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Overdue follow-ups" icon={CalendarClock} href="/follow-ups" linkLabel="Follow-ups">
          {d.overdueLeads.length === 0 ? <Empty>Nothing overdue.</Empty> : d.overdueLeads.slice(0, 8).map((l) => (
            <Link key={l.leadId} href={`/leads/${l.leadId}`} className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{l.companyName}</div>
                <div className="truncate text-xs text-slate-500">{l.contactName} · {l.ownerName} · due {formatDate(l.nextFollowUp)}</div>
              </div>
              <StageBadge stage={l.stage} />
            </Link>
          ))}
        </Section>
        <Section title="Stuck deals" icon={Hourglass}>
          {!d.stuckLeads?.length ? <Empty>No deal is stuck.</Empty> : d.stuckLeads.slice(0, 8).map((l) => (
            <Link key={l.leadId} href={`/leads/${l.leadId}`} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{l.companyName}</div>
                <div className="truncate text-xs text-slate-500">{l.ownerName} · no progress since {formatDate(l.since)}{l.value ? ` · ${inrShort(l.value)}` : ""}</div>
              </div>
              <StageBadge stage={l.stage} />
            </Link>
          ))}
        </Section>
      </div>
    </div>
  );
}
