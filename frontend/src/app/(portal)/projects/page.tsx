"use client";
import { AlertTriangle, CheckCircle2, FolderKanban, FolderPlus, Wallet, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BoardCard } from "@/components/crm/board-card";
import { EditLeadSheet } from "@/components/crm/edit-lead-sheet";
import { leadTarget } from "@/components/crm/lead-card";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { NewProjectFlow } from "@/components/projects/new-project";
import { ProjectTable } from "@/components/projects/project-table";
import { Button } from "@/components/ui/button";
import { BOARD_TABLE, ViewToggle } from "@/components/ui/view-toggle";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { BoardSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useAllPages } from "@/hooks/use-all-pages";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { STAGE_LABEL } from "@/lib/format";
import { inrShort } from "@/lib/money";
import { canAssignLeads, isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Paged } from "@/types/api";
import type { AssignableUser, Lead, StageKey } from "@/types/crm";

type Status = "active" | "won" | "lost";
type Layout = "board" | "table";
type Summary = {
  active: number;
  byStage: { stage: StageKey; count: number }[];
  openValue: number;
  overdue: number;
  wonThisMonth: { count: number; value: number };
  lostThisMonth: number;
};
type Filters = { clients: { id: string; name: string }[]; occasions: string[] };

const ACTIVE: StageKey[] = ["project_follow_up", "project_meeting", "project_proposal", "project_negotiation"];
const COLUMN_TONE: Record<string, string> = {
  project_follow_up: "bg-slate-100/80",
  project_meeting: "bg-sky-50/80",
  project_proposal: "bg-violet-50/80",
  project_negotiation: "bg-amber-50/70",
};
const ORIGINS = [["outbound", "We pitched"], ["inbound", "Client asked"], ["occasion", "Occasion"], ["repeat", "Repeat"]] as const;
const LAYOUT_KEY = "tofaa-projects-layout";
const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-40";

/**
 * Projects: every client project in one place, separate from new-business Leads. Numbers on top, Active / Won / Lost,
 * a board (drag to move) or a table, and filters by client, occasion, how it came in, owner and stage.
 */
export default function ProjectsPage() {
  const router = useRouter();
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);

  const [status, setStatus] = useState<Status>("active");
  const [layout, setLayout] = useState<Layout>("board");
  const [search, setSearch] = useState("");
  const [client, setClient] = useState("");
  const [occasion, setOccasion] = useState("");
  const [origin, setOrigin] = useState("");
  const [owner, setOwner] = useState("");
  const [stage, setStage] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = useDebounce(search, 300);

  // Start where the person left off; ?client=ID (from a client's card) opens that client's projects.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    let saved: string | null = null;
    try { saved = localStorage.getItem(LAYOUT_KEY); } catch { /* storage unavailable */ }
    setLayout(saved === "table" || saved === "board" ? saved : window.innerWidth < 768 ? "table" : "board");
    if (p.get("client")) setClient(p.get("client")!);
    if (p.get("new") === "1") setCreating(true);
    if ([...p.keys()].length) window.history.replaceState(null, "", "/projects");
  }, []);

  const chooseLayout = (l: Layout) => {
    setLayout(l);
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* ignore */ }
  };
  const reset = (fn: () => void) => fn();
  const clearFilters = () => reset(() => { setSearch(""); setClient(""); setOccasion(""); setOrigin(""); setOwner(""); setStage(""); setOverdue(false); });

  const common = { pipeline: "client", search: q || undefined, companyId: client || undefined, occasion: occasion || undefined, origin: origin || undefined, ownerId: owner || undefined };
  const showBoard = status === "active" && layout === "board";
  const stageParam = status === "won" ? "closed_won" : status === "lost" ? "closed_lost" : stage || ACTIVE.join(",");
  const board = useApi<Lead[]>(showBoard ? "/leads/board" : null, { ...common, overdue: overdue || undefined });
  const list = useAllPages<Paged<Lead>>(showBoard ? null : "/leads", { ...common, stage: stageParam, overdue: status === "active" && overdue ? true : undefined });
  const summary = useApi<Summary>("/projects/summary", { ownerId: common.ownerId, companyId: common.companyId, occasion: common.occasion, origin: common.origin, search: common.search });
  const filters = useApi<Filters>("/projects/filters");
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reload = () => { void board.reload(); void list.reload(); void summary.reload(); void filters.reload(); };
  const actions = useLeadActions(reload);

  const boardItems = useMemo(() => (board.data ?? []).filter((l) => ACTIVE.includes(l.stage)), [board.data]);
  const byStage = useMemo(() => Object.fromEntries(ACTIVE.map((s) => [s, boardItems.filter((l) => l.stage === s)])), [boardItems]);
  const filtering = !!(q || client || occasion || origin || owner || stage || overdue);
  const active = showBoard ? board : list;
  const isEmpty = showBoard ? boardItems.length === 0 : (list.data?.items.length ?? 0) === 0;
  const clientName = filters.data?.clients.find((c) => c.id === client)?.name;
  const s = summary.data;

  function drop(to: StageKey) {
    const project = boardItems.find((l) => l.id === dragId);
    setDragId(null);
    setOver(null);
    if (project && project.stage !== to) actions.moveTo(leadTarget(project), to);
  }

  const statusTab = (value: Status, label: string, count?: number) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={status === value}
      onClick={() => reset(() => { setStatus(value); setStage(""); })}
      className={cn("pressable flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium", status === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
    >
      {label}
      {count !== undefined && <span className={cn("rounded-full px-1.5 text-[12px] font-semibold", status === value ? "bg-brand-soft text-brand" : "bg-slate-200/80 text-slate-500")}>{count}</span>}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Projects" />

      {/* the numbers */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <Stat icon={<FolderKanban className="h-4 w-4" />} tone="bg-brand-soft text-brand" label="Active projects" value={s ? String(s.active) : "—"} hint={s ? stageMix(s.byStage) : undefined} />
        <Stat icon={<Wallet className="h-4 w-4" />} tone="bg-sky-50 text-sky-600" label="Pipeline value" value={s ? inrShort(s.openValue) || "₹0" : "—"} hint="Open projects, best known figure" />
        <Stat
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="bg-red-50 text-red-600"
          label="Overdue follow-ups"
          value={s ? String(s.overdue) : "—"}
          hint={s?.overdue ? (overdue ? "Showing them" : "Tap to show them") : "All on time"}
          onClick={s?.overdue ? () => reset(() => { setStatus("active"); setOverdue((o) => !o); }) : undefined}
          active={overdue}
        />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} tone="bg-emerald-50 text-emerald-600" label="Won this month" value={s ? String(s.wonThisMonth.count) : "—"} hint={s ? `${inrShort(s.wonThisMonth.value) || "₹0"} · ${s.lostThisMonth} lost` : undefined} />
      </div>

      {/* status tabs and layout */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Project status">
          {statusTab("active", "Active", s?.active)}
          {statusTab("won", "Won")}
          {statusTab("lost", "Lost")}
        </div>
        <div className="flex items-center gap-2">
          {status === "active" && (
            <ViewToggle value={layout} onChange={chooseLayout} options={BOARD_TABLE} />
          )}
          <Button onClick={() => setCreating(true)}><FolderPlus className="h-4 w-4" /> New project</Button>
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="sm:w-56 lg:w-60" value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search clients" />
        <select className={select} value={client} onChange={(e) => reset(() => setClient(e.target.value))} aria-label="Client">
          <option value="">All clients</option>
          {client && !clientName && <option value={client}>This client</option>}
          {filters.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={select} value={occasion} onChange={(e) => reset(() => setOccasion(e.target.value))} aria-label="Occasion">
          <option value="">All occasions</option>
          {filters.data?.occasions.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className={select} value={origin} onChange={(e) => reset(() => setOrigin(e.target.value))} aria-label="How it came in">
          <option value="">Any origin</option>
          {ORIGINS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {status === "active" && !showBoard && (
          <select className={select} value={stage} onChange={(e) => reset(() => setStage(e.target.value))} aria-label="Stage">
            <option value="">All stages</option>
            {ACTIVE.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
          </select>
        )}
        {manager && user && (
          <select className={select} value={owner} onChange={(e) => reset(() => setOwner(e.target.value))} aria-label="Owner">
            <option value="">Whole team</option>
            <option value={user.id}>Mine</option>
            {people.data?.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
        {status === "active" && (
          <button type="button" onClick={() => reset(() => setOverdue((o) => !o))} aria-pressed={overdue} className={cn("pressable h-10 shrink-0 rounded-xl border px-4 text-sm font-medium", overdue ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300/80 bg-white text-slate-600")}>
            Overdue
          </button>
        )}
        {filtering && (
          <button type="button" onClick={clearFilters} className="pressable inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="h-4 w-4" /> Clear
          </button>
        )}
      </div>

      {/* content */}
      {active.loading && !active.data && (showBoard ? <BoardSkeleton /> : <TableSkeleton columns={6} rows={8} />)}
      {active.error && !active.data && <StateView kind="error" message={active.error} onRetry={reload} />}
      {active.data && isEmpty && (
        <StateView
          kind="empty"
          title={filtering ? "Nothing matches" : status === "won" ? "No won projects yet" : status === "lost" ? "No lost projects" : "No active projects"}
          message={filtering ? "Try a different search or clear the filters." : status === "active" ? "Start one for a client: an occasion coming up, a repeat order, or a client who called in." : "They will show up here."}
          action={filtering ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : status === "active" ? <Button onClick={() => setCreating(true)}><FolderPlus className="h-4 w-4" /> New project</Button> : undefined}
        />
      )}

      {showBoard && board.data && !isEmpty && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {ACTIVE.map((st) => (
            <div
              key={st}
              onDragOver={(e) => { e.preventDefault(); setOver(st); }}
              onDragLeave={() => setOver((o) => (o === st ? null : o))}
              onDrop={() => drop(st)}
              className={cn("flex min-h-0 min-w-[16.5rem] flex-1 flex-col rounded-2xl p-2.5", COLUMN_TONE[st], over === st && "ring-2 ring-brand/40")}
            >
              <div className="mb-2 flex items-center justify-between gap-1 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="truncate">{STAGE_LABEL[st]}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">{byStage[st].length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                {byStage[st].length === 0 && <p className="px-1 py-6 text-center text-xs text-slate-400">Drop a project here</p>}
                {byStage[st].map((p) => <BoardCard key={p.id} lead={p} showOwner={manager} onDragStart={setDragId} onOpen={() => router.push(`/projects/${p.id}`)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!showBoard && list.data && !isEmpty && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProjectTable projects={list.data.items} showOwner={manager} canReassign={!!user && canAssignLeads(user.role)} actions={actions} onEdit={setEditing} />
        </div>
      )}

      <NewProjectFlow open={creating} onClose={() => setCreating(false)} onCreated={(pid) => router.push(`/projects/${pid}`)} />
      {editing && <EditLeadSheet lead={editing} meta={actions.meta ?? undefined} open onClose={() => setEditing(null)} onSaved={reload} />}
      {actions.sheets}
    </div>
  );
}

/** "3 follow-up · 2 proposal": where the active projects sit. */
function stageMix(byStage: Summary["byStage"]): string {
  const short: Record<string, string> = { project_follow_up: "follow-up", project_meeting: "meeting", project_proposal: "proposal", project_negotiation: "negotiation" };
  const parts = byStage.filter((b) => b.count > 0).map((b) => `${b.count} ${short[b.stage] ?? b.stage}`);
  return parts.length ? parts.join(" · ") : "None open";
}

function Stat({ icon, tone, label, value, hint, onClick, active }: { icon: ReactNode; tone: string; label: string; value: string; hint?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</span>
        <span className="truncate text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="mt-2 truncate text-xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>}
    </>
  );
  const cls = cn("min-w-0 rounded-2xl border bg-white p-3.5 text-left shadow-sm", active ? "border-red-300 ring-2 ring-red-100" : "border-slate-200/70");
  return onClick ? <button type="button" onClick={onClick} aria-pressed={active} className={cn(cls, "pressable hover:border-slate-300")}>{body}</button> : <div className={cls}>{body}</div>;
}
