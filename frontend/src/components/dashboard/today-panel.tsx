"use client";
import { CalendarClock, Check, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ContactButtons } from "@/components/crm/contact-buttons";
import { ClientFollowUpSheet, type ClientTaskTarget } from "@/components/clients/followup-sheets";
import type { LeadTarget } from "@/components/crm/types";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/ui/stage-badge";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime, openWhatsApp } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { MeetingItem, NoNextAction, StageKey, TaskItem, TodayView } from "@/types/crm";

type EndOfDay = { incomplete: TaskItem[]; noNextAction: NoNextAction[] };

function Section({ title, count, tone, children }: { title: string; count: number; tone?: string; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className={cn("flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500", tone)}>
        {title} <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ItemShell({ href, title, sub, stage, highlight, right }: { href: string; title: string; sub: string; stage?: StageKey; highlight?: boolean; right: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-sm", highlight ? "border-red-200 bg-red-50/50" : "border-slate-200")}>
      <Link href={href} className="min-w-0 flex-1">
        <div className="truncate font-medium text-slate-900">{title}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="truncate">{sub}</span>
          {stage && <StageBadge stage={stage} />}
        </div>
      </Link>
      {right}
    </div>
  );
}

/**
 * "Today" at the top of a KAM's Dashboard (it used to be its own page): calls and follow-ups due today,
 * overdue ones, today's meetings, leads with no next action, and the end-of-day check. The monthly target is not
 * repeated here: the Dashboard already shows it.
 */
export function TodayPanel() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const today = useApi<TodayView>("/today");
  const [eodOpen, setEodOpen] = useState(false);
  const [finishing, setFinishing] = useState<ClientTaskTarget | null>(null);
  const router = useRouter();
  const eod = useApi<EndOfDay>(eodOpen ? "/today/end-of-day" : null);
  const refresh = () => { void today.reload(); if (eodOpen) void eod.reload(); };
  const actions = useLeadActions(refresh);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("eod") === "1") setEodOpen(true);
  }, []);

  const taskTarget = (t: TaskItem): LeadTarget => ({
    leadId: t.leadId ?? "", name: t.projectTitle ? `${t.companyName} · ${t.projectTitle}` : `${t.companyName} · ${t.contactName}`,
    phone: t.phone, stage: t.stage ?? "project_follow_up", pipeline: t.pipeline,
  });
  const taskRow = (t: TaskItem, overdue = false) => {
    const client = !!t.isClientTask;  // an occasion call or check-in, not tied to a deal
    return (
      <ItemShell
        key={t.id}
        href={client ? `/clients/${t.companyId}` : t.pipeline === "client" ? `/projects/${t.leadId}` : `/leads/${t.leadId}`}
        title={t.projectTitle ? `${t.companyName} · ${t.projectTitle}` : t.companyName}
        sub={`${client ? "Client · " : t.pipeline === "client" ? "Project · " : ""}${t.contactName ?? ""} · ${overdue ? `due ${formatDate(t.dueDate)}` : t.title ?? "Follow-up"}`}
        stage={t.stage ?? undefined}
        highlight={overdue}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Mark done"
              onClick={() => (client ? setFinishing({ taskId: t.id, companyId: t.companyId!, companyName: t.companyName, title: t.title }) : actions.complete({ id: t.id, name: t.companyName }))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              <Check className="h-4 w-4" />
            </button>
            <ContactButtons
              onCall={() => (client ? (t.phone ? (window.location.href = `tel:${t.phone}`) : undefined) : actions.call(taskTarget(t)))}
              onWhatsApp={() => (client ? openWhatsApp(t.phone) : actions.whatsapp(taskTarget(t)))}
              disabled={!t.phone}
            />
          </div>
        }
      />
    );
  };
  const meetingRow = (m: MeetingItem) => {
    const t: LeadTarget = { leadId: m.leadId, name: `${m.companyName} · ${m.contactName}`, phone: m.phone, stage: "meeting_scheduled" };
    return (
      <ItemShell
        key={m.id}
        href={`/leads/${m.leadId}`}
        title={`${formatTime(m.startsAt)} · ${m.companyName}`}
        sub={`${m.kind === "online" ? "Online" : "Physical"}${m.location || m.link ? ` · ${m.location ?? m.link}` : ""}`}
        right={<ContactButtons onCall={() => actions.call(t)} onWhatsApp={() => actions.whatsapp(t)} disabled={!m.phone} />}
      />
    );
  };
  const noActionRow = (n: NoNextAction) => {
    const t: LeadTarget = { leadId: n.leadId, name: `${n.companyName} · ${n.contactName}`, phone: n.phone, stage: n.stage };
    return (
      <ItemShell
        key={n.leadId}
        href={`/leads/${n.leadId}`}
        title={n.companyName}
        sub={n.contactName}
        stage={n.stage}
        right={
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="h-10 px-3" onClick={() => actions.schedule(t)}>
              <CalendarClock className="h-4 w-4" /> Set date
            </Button>
            <ContactButtons onCall={() => actions.call(t)} onWhatsApp={() => actions.whatsapp(t)} disabled={!n.phone} />
          </div>
        }
      />
    );
  };

  const d = today.data;
  const empty = !!d && !d.dueToday.length && !d.overdue.length && !d.meetings.length && !d.noNextAction.length;
  // Shown only when there is something for today. While loading, on an error, or with nothing due, the Dashboard
  // starts straight with the rest (no spinner, no empty box). The dialogs stay mounted, so the end-of-day check
  // from the evening notification (?eod=1) still opens.
  const show = !!d && !empty;
  const dialogs = (
    <>
      <Sheet open={eodOpen} title="End-of-day check" subtitle="Reschedule or close what is left" icon={ClipboardCheck} tone="indigo" onClose={() => setEodOpen(false)}>
        {eod.loading && !eod.data ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : eod.data && !eod.data.incomplete.length && !eod.data.noNextAction.length ? (
          <p className="py-6 text-center text-sm text-slate-600">All clear. Nothing left open today.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Reschedule or close what is left, so tomorrow starts clean.</p>
            {eod.data?.incomplete.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                <span className="truncate">{t.companyName} <span className="text-slate-400">· due {formatDate(t.dueDate)}</span></span>
                <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => (t.isClientTask ? setFinishing({ taskId: t.id, companyId: t.companyId!, companyName: t.companyName, title: t.title }) : actions.schedule(taskTarget(t)))}>{t.isClientTask ? "Update" : "Reschedule"}</Button>
              </div>
            ))}
            {eod.data?.noNextAction.map((n) => (
              <div key={n.leadId} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm">
                <span className="truncate">{n.companyName} <span className="text-slate-400">· no next action</span></span>
                <div className="flex gap-1">
                  <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => actions.schedule({ leadId: n.leadId, name: n.companyName, phone: n.phone, stage: n.stage })}>Set date</Button>
                  <Button variant="ghost" className="px-3 py-1 text-xs text-red-600" onClick={() => actions.moveTo({ leadId: n.leadId, name: n.companyName, phone: n.phone, stage: n.stage }, "closed_lost")}>Close</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Sheet>
      <ClientFollowUpSheet target={finishing} onClose={() => setFinishing(null)} onDone={(pid) => (pid ? router.push(`/projects/${pid}`) : refresh())} />
      {actions.sheets}
    </>
  );
  if (!show) return dialogs;

  return (
    <section id="today" aria-label="Today" className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">Today</h2>
          <p className="text-sm text-slate-500">
            Hi{user?.fullName ? ` ${user.fullName.split(" ")[0]}` : ""}
            {d && <> · <b className="font-semibold text-slate-700">{d.counts.dueToday}</b> due today · <b className={cn("font-semibold", d.counts.overdue ? "text-red-600" : "text-slate-700")}>{d.counts.overdue}</b> overdue · <b className="font-semibold text-slate-700">{d.counts.meetings}</b> {d.counts.meetings === 1 ? "meeting" : "meetings"}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/follow-ups" className="inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium text-brand hover:bg-brand-soft">All follow-ups</Link>
          <Button variant="secondary" onClick={() => setEodOpen(true)}>
            <ClipboardCheck className="h-4 w-4" /> End-of-day check
          </Button>
        </div>
      </div>
      {d && (
        <>
          <div className="grid items-start gap-6 lg:grid-cols-2">
          <Section title="Calls and follow-ups due today" count={d.dueToday.length}>{d.dueToday.map((t) => taskRow(t))}</Section>
          <Section title="Overdue" count={d.overdue.length} tone="text-red-600">{d.overdue.map((t) => taskRow(t, true))}</Section>
          <Section title="Meetings today" count={d.meetings.length}>
            {d.meetings.map(meetingRow)}
          </Section>
          <Section title="Leads with no next action" count={d.noNextAction.length}>{d.noNextAction.map(noActionRow)}</Section>
          </div>
        </>
      )}

      {dialogs}
    </section>
  );
}
