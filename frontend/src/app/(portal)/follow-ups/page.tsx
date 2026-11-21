"use client";
import { CalendarClock, CheckCircle2, MapPin, MessageCircle, Phone, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientFollowUpSheet, type ClientTaskTarget } from "@/components/clients/followup-sheets";
import type { LeadTarget } from "@/components/crm/types";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { FollowUpDoneSheet } from "@/components/followups/done-sheet";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StageBadge } from "@/components/ui/stage-badge";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { formatDate, formatTime, openWhatsApp, telHref } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, FollowUpItem, FollowUpsView } from "@/types/crm";

type ColumnKey = "overdue" | "today" | "tomorrow" | "thisWeek";
const COLUMNS: { key: ColumnKey; label: string; hint: string; tone: string; dot: string }[] = [
  { key: "overdue", label: "Overdue / missed", hint: "Past the date", tone: "bg-red-50/70", dot: "bg-red-500" },
  { key: "today", label: "Today", hint: "Due today", tone: "bg-violet-50/70", dot: "bg-brand" },
  { key: "tomorrow", label: "Tomorrow", hint: "Due tomorrow", tone: "bg-sky-50/70", dot: "bg-sky-500" },
  { key: "thisWeek", label: "This week", hint: "Next 7 days", tone: "bg-slate-100/80", dot: "bg-slate-400" },
];
const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";

const IST = "Asia/Kolkata";
const weekday = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short" }).format(new Date(`${iso}T12:00:00+05:30`));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/** When the follow-up is, in words: "Meeting · 3:30 PM", "2 days overdue", "Thu, 20 Nov". */
function whenLabel(f: FollowUpItem, column: ColumnKey, today: string): string {
  const meetingAt = f.meeting?.startsAt;
  if (meetingAt) {
    const day = column === "today" || (column === "overdue" && meetingAt.slice(0, 10) === today) ? "" : column === "tomorrow" ? "Tomorrow, " : `${formatDate(meetingAt)}, `;
    return `Meeting · ${day}${formatTime(meetingAt)}`;
  }
  if (column === "overdue") {
    const late = daysBetween(f.dueDate, today);
    return late === 1 ? "1 day overdue" : `${late} days overdue`;
  }
  if (column === "today") return "Today";
  if (column === "tomorrow") return "Tomorrow";
  return `${weekday(f.dueDate)}, ${formatDate(f.dueDate)}`;
}

/** Every open follow-up for the week, in four columns. Each card: who, when, Call, WhatsApp, and "Follow-up done". */
export default function FollowUpsPage() {
  const router = useRouter();
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);
  const [owner, setOwner] = useState("");
  const [doneItem, setDoneItem] = useState<FollowUpItem | null>(null);
  const [clientTask, setClientTask] = useState<ClientTaskTarget | null>(null);

  const view = useApi<FollowUpsView>("/follow-ups", { ownerId: owner || undefined });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const actions = useLeadActions(() => void view.reload());

  const target = (f: FollowUpItem): LeadTarget => ({
    leadId: f.leadId ?? "",
    name: f.projectTitle ? `${f.companyName} · ${f.projectTitle}` : `${f.companyName} · ${f.contactName}`,
    phone: f.phone, stage: f.stage ?? "project_follow_up", pipeline: f.pipeline, companyId: f.companyId ?? undefined,
  });
  const open = (f: FollowUpItem) => router.push(f.isClientTask ? `/clients/${f.companyId}` : f.pipeline === "client" ? `/projects/${f.leadId}` : `/leads/${f.leadId}`);
  const call = (f: FollowUpItem) => {
    if (f.isClientTask) { const h = telHref(f.phone); if (h) window.location.href = h; }
    else actions.call(target(f));
  };
  const whatsapp = (f: FollowUpItem) => (f.isClientTask ? openWhatsApp(f.phone) : actions.whatsapp(target(f)));
  const done = (f: FollowUpItem) =>
    f.isClientTask ? setClientTask({ taskId: f.id, companyId: f.companyId!, companyName: f.companyName, title: f.title }) : setDoneItem(f);

  const data = view.data;
  const total = data ? data.overdue.length + data.today.length + data.tomorrow.length + data.thisWeek.length : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Follow-ups" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-meta">
          {data ? (total ? <><b className="font-semibold text-slate-700">{total}</b> open follow-up{total === 1 ? "" : "s"} this week{data.overdue.length ? <> · <b className="font-semibold text-red-600">{data.overdue.length} overdue</b></> : null}</> : "Nothing due this week") : " "}
        </p>
        {manager && user && (
          <select className={select} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
            <option value="">Whole team</option>
            <option value={user.id}>Mine</option>
            {people.data?.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
      </div>

      {view.loading && !data ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : view.error && !data ? (
        <StateView kind="error" message={view.error} onRetry={() => void view.reload()} />
      ) : data && total === 0 ? (
        <StateView kind="empty" title="All caught up" message="No follow-ups are due this week. New ones appear here as you schedule them." />
      ) : data ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {COLUMNS.map((c) => (
            <section key={c.key} aria-label={c.label} className={cn("flex min-h-0 min-w-[17rem] flex-1 flex-col rounded-2xl p-2.5", c.tone)}>
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">{c.label}</span>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{data[c.key].length}</span>
              </header>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                {data[c.key].length === 0 && <p className="px-1 py-8 text-center text-xs text-slate-400">Nothing {c.hint.toLowerCase()}</p>}
                {data[c.key].map((f) => (
                  <FollowUpCard key={f.id} f={f} when={whenLabel(f, c.key, data.date)} late={c.key === "overdue"} onOpen={() => open(f)} onCall={() => call(f)} onWhatsApp={() => whatsapp(f)} onDone={() => done(f)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      <FollowUpDoneSheet item={doneItem} onClose={() => setDoneItem(null)} onDone={() => void view.reload()} onMoveStage={(f, s) => actions.moveTo(target(f), s)} />
      <ClientFollowUpSheet target={clientTask} onClose={() => setClientTask(null)} onDone={(pid) => (pid ? router.push(`/projects/${pid}`) : void view.reload())} />
      {actions.sheets}
    </div>
  );
}

type CardProps = { f: FollowUpItem; when: string; late: boolean; onOpen: () => void; onCall: () => void; onWhatsApp: () => void; onDone: () => void };

function FollowUpCard({ f, when, late, onOpen, onCall, onWhatsApp, onDone }: CardProps) {
  const MeetingIcon = f.meeting?.kind === "online" ? Video : MapPin;
  const showTitle = f.title && f.title !== "Meeting";
  return (
    <article className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card">
      <button type="button" onClick={onOpen} className="block w-full min-w-0 text-left">
        <div className="t-body line-clamp-2 font-semibold leading-snug text-slate-900 hover:text-brand">{f.projectTitle ? `${f.companyName} · ${f.projectTitle}` : f.companyName}</div>
        <div className="t-meta truncate">{f.isClientTask ? "Client · " : ""}{f.contactName || "No contact"}</div>
      </button>

      <div className="space-y-1.5">
        <div className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", late ? "bg-red-50 text-red-700" : f.meeting ? "bg-violet-50 text-brand" : "bg-slate-100 text-slate-700")}>
          <CalendarClock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{when}</span>
        </div>
        {f.meeting && (f.meeting.location || f.meeting.kind === "online") && (
          <div className="t-meta flex min-w-0 items-center gap-1.5"><MeetingIcon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.meeting.kind === "online" ? "Online meeting" : f.meeting.location}</span></div>
        )}
        {showTitle && <p className="t-meta line-clamp-2">{f.title}</p>}
        {f.stage && <StageBadge stage={f.stage} />}
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" aria-label="Call" title={f.phone ?? "No phone number"} disabled={!f.phone} onClick={onCall} className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand hover:bg-brand-100 disabled:opacity-35">
          <Phone className="h-4 w-4" />
        </button>
        <button type="button" aria-label="WhatsApp" disabled={!f.phone} onClick={onWhatsApp} className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-35">
          <MessageCircle className="h-4 w-4" />
        </button>
        <Button onClick={onDone} className="h-9 min-h-0 min-w-0 flex-1 px-3 text-[13px]"><CheckCircle2 className="h-4 w-4" /><span className="truncate">Follow-up done</span></Button>
      </div>
    </article>
  );
}
