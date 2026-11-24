"use client";
import { CalendarCheck, CalendarClock, FileText, KanbanSquare, PhoneCall, Target, TrendingUp } from "lucide-react";
import Link from "next/link";
import { CallStatusBadge } from "@/components/crm/call-status-badge";
import { TargetCard } from "@/components/crm/target-card";
import { QUOTE_STATUS } from "@/components/lead/deal-cards";
import { formatDate, formatDateTime, STAGE_LABEL } from "@/lib/format";
import { inr, inrShort } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { QuotationStatus, StageKey, TargetCardData } from "@/types/crm";
import { Bars, Empty, Section, Tile } from "./widgets";

export type ExecutiveData = {
  pipeline: { count: number; value: number; weighted: number; byStage: { stage: StageKey; count: number; value: number }[] };
  target: TargetCardData | null;
  followUps: { overdue: number; today: number };
  callStatus: { outcome: string; count: number }[];
  quotations: {
    toSend: number; waitingApproval: number; sentThisMonth: number; sentValueThisMonth: number;
    recent: { id: string; leadId: string; version: number; status: QuotationStatus; total: number; createdAt: string; companyName?: string }[];
  };
  meetings: { id: string; leadId: string; startsAt: string; kind: string; location?: string | null; companyName?: string; contactName?: string }[];
};

/** A sales executive's own numbers: pipeline, target, follow-ups, call statuses, quotations and the week's meetings. */
export function ExecutiveDashboard({ d }: { d: ExecutiveData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="My pipeline" value={inrShort(d.pipeline.value)} hint={`${d.pipeline.count} open ${d.pipeline.count === 1 ? "deal" : "deals"}`} icon={KanbanSquare} href="/leads" />
        <Tile label="Weighted forecast" value={inrShort(d.pipeline.weighted)} hint="Value × stage probability" icon={TrendingUp} />
        <Tile label="Overdue follow-ups" value={String(d.followUps.overdue)} hint="Call these first" icon={CalendarClock} tone={d.followUps.overdue ? "text-red-600" : ""} href="/follow-ups" />
        <Tile label="Due today" value={String(d.followUps.today)} hint="Follow-ups for today" icon={CalendarCheck} href="/today" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {d.target ? (
          <div className="space-y-2">
            <TargetCard card={d.target} />
            <Link href="/my-target" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Target className="h-3 w-3" /> Open My Target</Link>
          </div>
        ) : (
          <Section title="My target" icon={Target} href="/my-target"><Empty>No target set for this month yet.</Empty></Section>
        )}

        <Section title="My pipeline by stage" icon={KanbanSquare} href="/leads" linkLabel="Leads">
          <Bars
            format={(n) => String(n)}
            empty="No open deals yet."
            rows={d.pipeline.byStage.map((s) => ({ key: s.stage, label: STAGE_LABEL[s.stage] ?? s.stage, value: s.count, hint: `value ${inr(s.value)}` }))}
          />
        </Section>

        <Section title="Call status (New & Connected)" icon={PhoneCall} href="/leads" linkLabel="Leads">
          {d.callStatus.length === 0 ? <Empty>No leads waiting for a call.</Empty> : (
            <ul className="flex flex-wrap gap-2">
              {d.callStatus.map((c) => (
                <li key={c.outcome} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                  <CallStatusBadge outcome={c.outcome === "none" ? null : c.outcome} /> {c.count}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="My quotations" icon={FileText} href="/quotations" linkLabel="Quotations">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["To send", d.quotations.toSend, d.quotations.toSend ? "text-brand" : ""], ["Waiting approval", d.quotations.waitingApproval, d.quotations.waitingApproval ? "text-amber-600" : ""], ["Sent this month", d.quotations.sentThisMonth, ""]].map(([label, n, tone]) => (
              <div key={label as string} className="rounded-xl bg-slate-50 p-2.5">
                <div className={cn("text-xl font-semibold tabular-nums text-slate-900", tone as string)}>{n as number}</div>
                <div className="text-[11px] text-slate-500">{label as string}</div>
              </div>
            ))}
          </div>
          {d.quotations.sentValueThisMonth > 0 && <p className="text-xs text-slate-500">Sent this month: <b className="text-slate-800">{inr(d.quotations.sentValueThisMonth)}</b></p>}
          {d.quotations.recent.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {d.quotations.recent.map((q) => (
                <li key={q.id}>
                  <Link href={`/leads/${q.leadId}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-brand">
                    <span className="min-w-0 truncate">{q.companyName} <span className="text-xs text-slate-400">v{q.version} · {formatDate(q.createdAt)}</span></span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-slate-700">{inrShort(q.total)}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", QUOTE_STATUS[q.status]?.tone)}>{QUOTE_STATUS[q.status]?.label ?? q.status}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Meetings this week" icon={CalendarCheck} className="lg:col-span-2">
          {d.meetings.length === 0 ? <Empty>No meetings in the next 7 days.</Empty> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {d.meetings.map((m) => (
                <li key={m.id}>
                  <Link href={`/leads/${m.leadId}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-brand/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><CalendarCheck className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{m.companyName}</span>
                      <span className="block truncate text-xs text-slate-500">{formatDateTime(m.startsAt)} · {m.kind === "online" ? "Online" : m.location || "In person"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
