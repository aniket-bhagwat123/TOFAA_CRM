"use client";
import { ArrowDown, ArrowUp, CalendarPlus, CheckCircle2, CircleSlash, Columns3, List, Phone, Plus, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ClientFollowUpSheet, type ClientTaskTarget } from "@/components/clients/followup-sheets";
import type { LeadTarget } from "@/components/crm/types";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { AddTaskSheet } from "@/components/followups/add-task-sheet";
import { FollowUpDoneSheet } from "@/components/followups/done-sheet";
import {
  ActionRow, attemptLabel, type ColumnKey, dealName, dueMs, FlagChips, FollowUpCard, isEscalated, KIND_LABEL, KindChip, kindOf, SnoozeButton,
  StageChip, TagChips, whenLabel,
} from "@/components/followups/followup-card";
import { LeadPanel } from "@/components/followups/lead-panel";
import { RescheduleSheet, type RescheduleTarget } from "@/components/followups/reschedule-sheet";
import { REPEAT_LIMIT, SnoozeSheet } from "@/components/followups/snooze-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { Tooltip } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { formatTime, OUTCOME_LABEL, openWhatsApp, PIPELINE_STAGES, STAGE_LABEL, telHref, todayIso } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { AssignableUser, FollowUpItem, FollowUpsView, NoNextActionRow } from "@/types/crm";

const COLUMNS: { key: ColumnKey; label: string; hint: string; tone: string; dot: string }[] = [
  { key: "overdue", label: "Overdue / missed", hint: "Past the date", tone: "bg-red-50/70", dot: "bg-red-500" },
  { key: "today", label: "Today", hint: "Due today", tone: "bg-violet-50/70", dot: "bg-brand" },
  { key: "tomorrow", label: "Tomorrow", hint: "Due tomorrow", tone: "bg-sky-50/70", dot: "bg-sky-500" },
  { key: "laterThisWeek", label: "Later this week", hint: "Due in the next 7 days", tone: "bg-slate-100/80", dot: "bg-slate-400" },
  { key: "later", label: "Later", hint: "Due after this week", tone: "bg-slate-50", dot: "bg-slate-300" },
];
/** One tag filter instead of a dropdown plus two toggles. One tag at a time. */
const TAGS = [
  { value: "requested", label: "Client requested" },
  { value: "nurture", label: "Nurture" },
  { value: "warm", label: "Warm" },
  { value: "cold", label: "Cold" },
];
const STAGE_OPTIONS = [...PIPELINE_STAGES.new_business, ...PIPELINE_STAGES.client];
/** Layout of the open follow-ups (remembered), and the two other lists that can be opened instead. */
type Layout = "board" | "list";
type Extra = "done" | "none" | null;
const VIEW_KEY = "followups.view"; // the Board / List toggle remembers the last choice (this browser)
const readLayout = (): Layout => {
  try { return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board"; } catch { return "board"; }
};
type Filters = { q: string; kind: string; stage: string; tag: string };
const NO_FILTERS: Filters = { q: "", kind: "", stage: "", tag: "" };

function matches(f: FollowUpItem, x: Filters): boolean {
  if (x.tag === "requested" && !f.clientRequested) return false;
  if (x.tag === "nurture" && !f.nurture) return false;
  if ((x.tag === "warm" || x.tag === "cold") && f.temperature !== x.tag) return false;
  if (x.kind && kindOf(f) !== x.kind) return false;
  if (x.stage && (x.stage === "client" ? !f.isClientTask : f.stage !== x.stage)) return false;
  const q = x.q.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const hay = `${f.companyName} ${f.projectTitle ?? ""} ${f.contactName ?? ""}`.toLowerCase();
    const phoneHit = digits.length >= 3 && (f.phone ?? "").replace(/\D/g, "").includes(digits);
    if (!phoneHit && !q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function matchesLead(l: NoNextActionRow, x: Filters): boolean {
  if (x.stage && (x.stage === "client" || l.stage !== x.stage)) return false;
  if (x.kind || x.tag) return false; // task filters: a lead with no task has none of them
  const q = x.q.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 3 && (l.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
  const hay = `${l.companyName} ${l.projectTitle ?? ""} ${l.contactName ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

const leadTarget = (l: NoNextActionRow): LeadTarget => ({
  leadId: l.leadId, name: l.projectTitle ? `${l.companyName} · ${l.projectTitle}` : `${l.companyName} · ${l.contactName}`,
  phone: l.phone, stage: l.stage, pipeline: l.pipeline,
});

/**
 * Every open follow-up for the week, as a board (four columns) or a list, plus what was done today. Each follow-up:
 * who, stage and task type, due time, info line, owner, Call, WhatsApp, Log outcome and Snooze. Drag a card to another
 * column to reschedule it; click it to see the lead in a side panel.
 */
export default function FollowUpsPage() {
  const router = useRouter();
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);
  const [owner, setOwner] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [layout, setLayoutState] = useState<Layout>("board");
  const [extra, setExtra] = useState<Extra>(null); // Done today / No next action, opened over the layout
  useEffect(() => setLayoutState(readLayout()), []); // after mount: localStorage is not there during server render
  const setLayout = (v: Layout) => {
    setLayoutState(v);
    setExtra(null);
    try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: not remembered */ }
  };
  const toggleExtra = (e: Exclude<Extra, null>) => setExtra((x) => (x === e ? null : e));
  const view = extra ?? layout;
  const [doneItem, setDoneItem] = useState<FollowUpItem | null>(null);
  const [snoozing, setSnoozing] = useState<FollowUpItem | null>(null);
  const [clientTask, setClientTask] = useState<ClientTaskTarget | null>(null);
  const [panelLead, setPanelLead] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<{ item: FollowUpItem; from: ColumnKey } | null>(null);
  const [dropOn, setDropOn] = useState<ColumnKey | null>(null);
  const [moving, setMoving] = useState<RescheduleTarget | null>(null);

  const api = useApi<FollowUpsView>("/follow-ups", { ownerId: owner || undefined });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reload = () => void api.reload();
  const actions = useLeadActions(reload);
  const set = (patch: Partial<Filters>) => setFilters((x) => ({ ...x, ...patch }));
  const showOwner = manager && !owner; // the "Whole team" view

  const target = (f: FollowUpItem): LeadTarget => ({
    leadId: f.leadId ?? "",
    name: f.projectTitle ? `${f.companyName} · ${f.projectTitle}` : `${f.companyName} · ${f.contactName}`,
    phone: f.phone, stage: f.stage ?? "project_follow_up", pipeline: f.pipeline, companyId: f.companyId ?? undefined,
  });
  const open = (f: FollowUpItem) => (f.isClientTask ? router.push(`/clients/${f.companyId}`) : setPanelLead(f.leadId));
  const finishClientTask = (f: FollowUpItem) => setClientTask({ taskId: f.id, companyId: f.companyId!, companyName: f.companyName, title: f.title });
  // Call dials and the outcome sheet is waiting when the call ends; that outcome finishes this follow-up.
  const call = (f: FollowUpItem) => {
    if (f.isClientTask) { const h = telHref(f.phone); if (h) window.location.href = h; finishClientTask(f); }
    else actions.call(f.meeting ? target(f) : { ...target(f), taskId: f.id });
  };
  const whatsapp = (f: FollowUpItem) => (f.isClientTask ? openWhatsApp(f.phone) : actions.whatsapp(target(f)));
  // Log outcome: the call outcome sheet (a meeting is finished by its own sheet, a client task by the client's).
  const logOutcome = (f: FollowUpItem) =>
    f.isClientTask ? finishClientTask(f) : f.meeting ? setDoneItem(f) : actions.logCall({ ...target(f), taskId: f.id });
  const handlers = (f: FollowUpItem) => ({
    onOpen: () => open(f), onCall: () => call(f), onWhatsApp: () => whatsapp(f), onLog: () => logOutcome(f), onSnooze: () => setSnoozing(f),
  });

  const data = useMemo(() => {
    const d = api.data;
    if (!d) return null;
    const keep = (xs: FollowUpItem[] = []) => xs.filter((f) => matches(f, filters));
    return {
      ...d, overdue: keep(d.overdue), today: keep(d.today), tomorrow: keep(d.tomorrow), laterThisWeek: keep(d.laterThisWeek), later: keep(d.later),
      doneToday: keep(d.doneToday),
      noNextAction: (d.noNextAction ?? []).filter((l) => matchesLead(l, filters)),
    };
  }, [api.data, filters]);
  // Counted from the columns on screen, so the numbers always match what is shown (filters included).
  const total = data ? COLUMNS.reduce((n, c) => n + data[c.key].length, 0) : 0;
  const week = data ? data.today.length + data.tomorrow.length + data.laterThisWeek.length : 0;
  const postponed = data ? COLUMNS.flatMap((c) => data[c.key]).filter((f) => (f.snoozeCount ?? 0) >= REPEAT_LIMIT).length : 0;
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const activeFilters = [filters.kind, filters.stage, filters.tag].filter(Boolean).length;

  // Drag to reschedule: Today, Tomorrow and This week take a drop (Overdue does not: nothing is moved into the past).
  const dropDate = (c: ColumnKey) => (c === "today" ? todayIso() : c === "tomorrow" ? todayIso(1) : c === "laterThisWeek" ? todayIso(2) : todayIso(8));
  // Later this week and Later span several days, so a drop on its own column can still pick another day.
  const canDrop = (c: ColumnKey) => !!dragging && c !== "overdue" && (c !== dragging.from || c === "laterThisWeek" || c === "later");
  const drop = (c: ColumnKey) => {
    if (dragging && canDrop(c)) setMoving({ item: dragging.item, date: dropDate(c), label: COLUMNS.find((x) => x.key === c)!.label });
    setDragging(null); setDropOn(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader title="Follow-ups" />

      {/* Row 1: search, the view toggle and Add task */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={filters.q} onChange={(q) => set({ q })} placeholder="Search company, contact, phone" className="min-w-0 flex-1 sm:max-w-sm" />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {/* Layout of the open follow-ups */}
          <div role="radiogroup" aria-label="Layout" className="flex h-10 shrink-0 items-center rounded-xl border border-slate-300/80 bg-white p-1">
            <LayoutButton active={!extra && layout === "board"} onClick={() => setLayout("board")} icon={<Columns3 className="h-4 w-4" />}>Board</LayoutButton>
            <LayoutButton active={!extra && layout === "list"} onClick={() => setLayout("list")} icon={<List className="h-4 w-4" />}>List</LayoutButton>
          </div>
          {/* Other lists: click to open, click again to go back */}
          <ListButton active={extra === "done"} onClick={() => toggleExtra("done")} icon={<CheckCircle2 className="h-4 w-4" />}
            count={data?.doneToday.length ?? 0} tone="emerald" label="Done today" />
          <ListButton active={extra === "none"} onClick={() => toggleExtra("none")} icon={<CircleSlash className="h-4 w-4" />}
            count={data?.noNextAction.length ?? 0} tone="amber" label="No next action" />
        </div>
        <Button onClick={() => setAdding(true)} className="h-10 min-h-0 shrink-0 whitespace-nowrap px-3.5"><Plus className="h-4 w-4" />Add task</Button>
      </div>

      {/* Row 2: filters (an active one turns blue), Clear, and the counts on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hidden items-center gap-1.5 text-sm font-medium text-slate-500 sm:flex">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filter
        </span>
        <FilterSelect label="Task type" value={filters.kind} onChange={(kind) => set({ kind })} all="All task types"
          options={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Stage" value={filters.stage} onChange={(stage) => set({ stage })} all="All stages"
          options={[...STAGE_OPTIONS.map((v) => ({ value: v, label: STAGE_LABEL[v] })), { value: "client", label: "Client follow-ups" }]} />
        <FilterSelect label="Tag" value={filters.tag} onChange={(tag) => set({ tag })} all="All tags" options={TAGS} />
        {manager && user && (
          <FilterSelect label="Owner" value={owner} onChange={setOwner} all="Whole team"
            options={[{ value: user.id, label: "Mine" }, ...(people.data ?? []).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.fullName ?? "Unnamed" }))]} />
        )}
        {filtered && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="pressable flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="h-3.5 w-3.5" aria-hidden="true" />Clear{activeFilters > 1 ? ` (${activeFilters})` : ""}
          </button>
        )}
        <p className="t-meta w-full whitespace-nowrap sm:ml-auto sm:w-auto">
          {data ? (total ? <>
            <b className="font-semibold text-slate-700">{total}</b> open follow-up{total === 1 ? "" : "s"}
            {" · "}<b className="font-semibold text-slate-700">{week}</b> due this week
            {data.overdue.length ? <> · <b className="font-semibold text-red-600">{data.overdue.length} overdue</b></> : null}
            {manager && postponed ? <> · <b className="font-semibold text-amber-700">{postponed} repeatedly postponed</b></> : null}
          </> : "No open follow-ups") : " "}
        </p>
      </div>

      {api.loading && !data ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : api.error && !data ? (
        <StateView kind="error" message={api.error} onRetry={reload} />
      ) : !data ? null : view === "done" ? (
        <DoneView items={data.doneToday} showOwner={showOwner} onOpen={open} />
      ) : view === "none" ? (
        <NoActionView rows={data.noNextAction} showOwner={showOwner}
          onOpen={(l) => setPanelLead(l.leadId)}
          onCall={(l) => actions.call(leadTarget(l))}
          onSchedule={(l) => actions.schedule(leadTarget(l))} />
      ) : total === 0 ? (
        <StateView kind="empty" title={filtered ? "No follow-ups match" : "All caught up"} message={filtered ? "Try another search or clear the filters." : "No open follow-ups. New ones appear here as you schedule them."} />
      ) : view === "list" ? (
        <>
          <div className="hidden min-h-0 flex-1 md:flex"><ListView data={data} showOwner={showOwner} handlers={handlers} /></div>
          <MobileList data={data} showOwner={showOwner} handlers={handlers} onOpen={open} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {COLUMNS.map((c) => c.key === "overdue" && data.overdue.length === 0 ? (
            // Nothing overdue: a narrow strip instead of a full, empty column.
            <section key={c.key} aria-label={`${c.label}: none`} title="Nothing overdue" className={cn("flex w-11 shrink-0 flex-col items-center gap-3 rounded-2xl py-3", c.tone)}>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">0</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 [writing-mode:vertical-rl] rotate-180">{c.label}</span>
            </section>
          ) : (
            <section
              key={c.key}
              aria-label={c.label}
              onDragOver={(e) => { if (canDrop(c.key)) { e.preventDefault(); setDropOn(c.key); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOn((x) => (x === c.key ? null : x)); }}
              onDrop={(e) => { e.preventDefault(); drop(c.key); }}
              className={cn("flex min-h-0 min-w-[19.5rem] flex-1 flex-col rounded-2xl p-2.5 transition-shadow", c.tone, dropOn === c.key && "ring-2 ring-brand ring-offset-1", dragging && !canDrop(c.key) && "opacity-60")}
            >
              <header className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", c.dot)} />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-600">{c.label}</span>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", c.key === "overdue" ? "bg-red-600 text-white" : "bg-white text-slate-600")}>{data[c.key].length}</span>
              </header>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                {dropOn === c.key && <p className="rounded-xl border-2 border-dashed border-brand/40 bg-white/70 py-3 text-center text-xs font-medium text-brand">Drop to move to {c.label.toLowerCase()}</p>}
                {data[c.key].length === 0 && dropOn !== c.key && <p className="px-1 py-8 text-center text-xs text-slate-400">Nothing {c.hint.toLowerCase()}</p>}
                {data[c.key].map((f) => (
                  <div key={f.id} onDragEnd={() => { setDragging(null); setDropOn(null); }}>
                    <FollowUpCard
                      f={f} when={whenLabel(f, c.key, data.date)} late={c.key === "overdue"} escalated={c.key === "overdue" && isEscalated(f, data.date)} snoozeOpen={snoozing?.id === f.id} showOwner={showOwner}
                      onDragStart={f.meeting ? undefined : () => setDragging({ item: f, from: c.key })}
                      {...handlers(f)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <AddTaskSheet open={adding} onClose={() => setAdding(false)} onDone={reload} />
      <RescheduleSheet target={moving} onClose={() => setMoving(null)} onDone={reload} />
      <SnoozeSheet item={snoozing} onClose={() => setSnoozing(null)} onDone={reload} />
      <LeadPanel leadId={panelLead} onClose={() => setPanelLead(null)} />
      <FollowUpDoneSheet item={doneItem} onClose={() => setDoneItem(null)} onDone={reload} onMoveStage={(f, s) => actions.moveTo(target(f), s)} />
      <ClientFollowUpSheet target={clientTask} onClose={() => setClientTask(null)} onDone={(pid) => (pid ? router.push(`/projects/${pid}`) : reload())} />
      {actions.sheets}
    </div>
  );
}

function LayoutButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick}
      className={cn("flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium", active ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100")}>
      {icon}{children}
    </button>
  );
}

/** Done today / No next action: a button with a count badge; blue while that list is open. */
function ListButton({ active, onClick, icon, count, tone, label }: {
  active: boolean; onClick: () => void; icon: ReactNode; count: number; tone: "emerald" | "amber"; label: string;
}) {
  const badge = tone === "emerald" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800";
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cn("pressable flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm font-medium",
        active ? "border-brand bg-brand-soft text-brand" : "border-slate-300/80 bg-white text-slate-600 hover:bg-slate-50")}>
      {icon}{label}
      {count > 0 && <span className={cn("min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none", active ? "bg-brand text-white" : badge)}>{count}</span>}
    </button>
  );
}

/** A compact filter: "All …" when unused; turns blue when it is filtering, so applied filters are easy to spot. */
function FilterSelect({ label, value, onChange, all, options }: {
  label: string; value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[];
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-[calc(50%-0.25rem)] cursor-pointer rounded-full border pl-3.5 pr-8 text-sm font-medium outline-none focus:ring-4 focus:ring-brand/15 sm:w-auto",
        value ? "border-brand bg-brand-soft text-brand" : "border-slate-300/80 bg-white text-slate-700 hover:border-slate-400",
      )}
    >
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

type Handlers = (f: FollowUpItem) => { onOpen: () => void; onCall: () => void; onWhatsApp: () => void; onLog: () => void; onSnooze: () => void };
type Board = Pick<FollowUpsView, "date" | "overdue" | "today" | "tomorrow" | "laterThisWeek" | "later">;

type Row = { f: FollowUpItem; col: ColumnKey };
const rowsOf = (data: Board): Row[] => COLUMNS.flatMap((c) => data[c.key].map((f) => ({ f, col: c.key })));
/** The note column: the task's own note, not a generated title ("Call again", "Call back (client requested)"). */
const noteOf = (f: FollowUpItem) =>
  f.title && f.title !== "Meeting" && f.title !== KIND_LABEL[kindOf(f)] && !/client requested|^call again$|^follow up: /i.test(f.title) ? f.title : "";

/** List view (desktop): one row per follow-up, sorted by due time (ascending by default; click the header to flip). */
function ListView({ data, showOwner, handlers }: { data: Board; showOwner: boolean; handlers: Handlers }) {
  const [asc, setAsc] = useState(true);
  const rows = useMemo(() => rowsOf(data).sort((a, b) => (dueMs(a.f) - dueMs(b.f)) * (asc ? 1 : -1)), [data, asc]);
  const th = "px-3 py-2.5 font-semibold whitespace-nowrap";
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <table className="w-full min-w-[72rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className={cn(th, "pl-4")} aria-sort={asc ? "ascending" : "descending"}>
              <button type="button" onClick={() => setAsc((x) => !x)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
                Due {asc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              </button>
            </th>
            <th className={th}>Company and contact</th>
            <th className={th}>Stage</th>
            <th className={th}>Task type</th>
            <th className={th}>Tag</th>
            <th className={th}>Attempt</th>
            <th className={th}>Note</th>
            <th className={cn(th, "pr-4 text-right")}>Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(({ f, col }) => {
            const h = handlers(f);
            const late = col === "overdue";
            const attempt = attemptLabel(f);
            return (
              <tr key={f.id} className={cn("align-middle", f.clientRequested && late && "bg-red-50/40")}>
                <td className={cn("whitespace-nowrap py-3 pl-4 pr-3 font-medium", late ? "text-red-600" : "text-slate-700")}>{whenLabel(f, col, data.date, true)}</td>
                <td className="max-w-[16rem] px-3 py-3">
                  <button type="button" onClick={h.onOpen} className="flex max-w-full items-center gap-2.5 text-left">
                    {showOwner && f.ownerName && <Tooltip label={f.ownerName}><Avatar src={f.ownerAvatarUrl} name={f.ownerName} size="xs" /></Tooltip>}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900 hover:text-brand">{dealName(f)}</span>
                      <span className="block truncate text-xs text-slate-500">{f.contactName || "No contact"}</span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3"><StageChip f={f} /></td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-1"><KindChip f={f} /><FlagChips f={f} late={late} escalated={late && isEscalated(f, data.date)} /></div>
                </td>
                <td className="px-3 py-3"><TagChips f={f} /></td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-700">{attempt ? attempt.replace("Attempt ", "") : <span className="text-slate-300">—</span>}</td>
                <td className="max-w-[14rem] px-3 py-3"><span className="block truncate text-slate-600" title={noteOf(f) || undefined}>{noteOf(f) || <span className="text-slate-300">—</span>}</span></td>
                <td className="py-3 pl-3 pr-4">
                  <div className="flex items-center justify-end gap-1">
                    <ActionRow f={f} onCall={h.onCall} onWhatsApp={h.onWhatsApp} onLog={h.onLog} compact snooze={<SnoozeButton f={f} onSnooze={h.onSnooze} side="top" />} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** List view on a phone: grouped sections Overdue, Today, Upcoming and Done, as cards. */
function MobileList({ data, showOwner, handlers, onOpen }: { data: Board & { doneToday: FollowUpItem[] }; showOwner: boolean; handlers: Handlers; onOpen: (f: FollowUpItem) => void }) {
  const groups: { label: string; rows: Row[]; tone: string }[] = [
    { label: "Overdue", rows: data.overdue.map((f) => ({ f, col: "overdue" as ColumnKey })), tone: "text-red-600" },
    { label: "Today", rows: data.today.map((f) => ({ f, col: "today" as ColumnKey })), tone: "text-brand" },
    {
      label: "Upcoming",
      rows: [...data.tomorrow.map((f) => ({ f, col: "tomorrow" as ColumnKey })), ...data.laterThisWeek.map((f) => ({ f, col: "laterThisWeek" as ColumnKey })), ...data.later.map((f) => ({ f, col: "later" as ColumnKey }))],
      tone: "text-slate-600",
    },
  ];
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto md:hidden">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="space-y-2.5">
          <h2 className={cn("px-1 text-[11px] font-semibold uppercase tracking-wide", g.tone)}>{g.label} · {g.rows.length}</h2>
          {g.rows.length === 0 && <p className="px-1 text-xs text-slate-400">Nothing here.</p>}
          {g.rows.map(({ f, col }) => (
            <FollowUpCard key={f.id} f={f} when={whenLabel(f, col, data.date, col !== "overdue" && col !== "today")} late={col === "overdue"}
              escalated={col === "overdue" && isEscalated(f, data.date)} showOwner={showOwner} {...handlers(f)} />
          ))}
        </section>
      ))}
      <section aria-label="Done" className="space-y-2.5">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Done · {data.doneToday.length}</h2>
        {data.doneToday.length === 0 ? <p className="px-1 text-xs text-slate-400">Nothing done yet today.</p> : <DoneList items={data.doneToday} showOwner={showOwner} onOpen={onOpen} />}
      </section>
    </div>
  );
}

/** Leads with no open task: each needs a next step. */
function NoActionView({ rows, showOwner, onOpen, onCall, onSchedule }: {
  rows: NoNextActionRow[]; showOwner: boolean; onOpen: (l: NoNextActionRow) => void; onCall: (l: NoNextActionRow) => void; onSchedule: (l: NoNextActionRow) => void;
}) {
  if (!rows.length) return <StateView kind="empty" title="Every lead has a next action" message="Open leads with no follow-up scheduled show up here." />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="mb-2 text-xs text-slate-500">Open leads with no follow-up scheduled. Set a next action so none of them is forgotten.</p>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white shadow-card">
        {rows.map((l) => (
          <li key={l.leadId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <button type="button" onClick={() => onOpen(l)} className="min-w-0 flex-1 basis-48 text-left">
              <div className="truncate text-sm font-semibold text-slate-900 hover:text-brand">{l.projectTitle ? `${l.companyName} · ${l.projectTitle}` : l.companyName}</div>
              <div className="truncate text-xs text-slate-500">{l.contactName || "No contact"}{l.phone ? ` · ${l.phone}` : ""}</div>
            </button>
            <StageChip f={{ stage: l.stage, companyKind: l.companyKind }} />
            {showOwner && l.ownerName && <Tooltip label={l.ownerName}><Avatar name={l.ownerName} size="xs" /></Tooltip>}
            <div className="flex items-center gap-1.5">
              <Tooltip label={l.phone ? `Call ${l.phone}` : "No phone number"}>
                <Button variant="secondary" disabled={!l.phone} onClick={() => onCall(l)} className="h-9 min-h-0 gap-1.5 whitespace-nowrap px-2.5 text-[13px]"><Phone className="h-4 w-4" />Call</Button>
              </Tooltip>
              <Button onClick={() => onSchedule(l)} className="h-9 min-h-0 gap-1.5 whitespace-nowrap px-2.5 text-[13px]"><CalendarPlus className="h-4 w-4" />Set next action</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Done view: what was finished today, newest first, with its outcome. */
function DoneView({ items, showOwner, onOpen }: { items: FollowUpItem[]; showOwner: boolean; onOpen: (f: FollowUpItem) => void }) {
  if (!items.length) return <StateView kind="empty" title="Nothing done yet today" message="Follow-ups you finish today (with their outcome) show up here." />;
  return <div className="min-h-0 flex-1 overflow-y-auto"><DoneList items={items} showOwner={showOwner} onOpen={onOpen} /></div>;
}

function DoneList({ items, showOwner, onOpen }: { items: FollowUpItem[]; showOwner: boolean; onOpen: (f: FollowUpItem) => void }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white shadow-card">
      {items.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
          <button type="button" onClick={() => onOpen(f)} className="min-w-0 flex-1 basis-40 text-left">
            <div className="truncate text-sm font-semibold text-slate-900 hover:text-brand">{dealName(f)}</div>
            <div className="truncate text-xs text-slate-500">{f.contactName || "No contact"}</div>
          </button>
          <span className="whitespace-nowrap rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{KIND_LABEL[kindOf(f)] ?? "Follow-up"}</span>
          <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700" title={f.outcome ?? undefined}>{OUTCOME_LABEL[f.outcome ?? ""] ?? f.outcome ?? "Done"}</span>
          {f.doneAt && <span className="whitespace-nowrap text-xs text-slate-500">{formatTime(f.doneAt).toUpperCase()}</span>}
          {showOwner && f.ownerName && <Avatar src={f.ownerAvatarUrl} name={f.ownerName} size="xs" />}
        </li>
      ))}
    </ul>
  );
}
