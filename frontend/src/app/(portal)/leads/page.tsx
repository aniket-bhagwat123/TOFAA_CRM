"use client";
import { Ban, Columns3, FileUp, KanbanSquare, Plus, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BoardCard } from "@/components/crm/board-card";
import { CALL_STATUS_OPTIONS, TAG_OPTIONS } from "@/components/crm/call-status-badge";
import { EditLeadSheet } from "@/components/crm/edit-lead-sheet";
import { ImportModal } from "@/components/crm/import-modal";
import { leadTarget } from "@/components/crm/lead-card";
import { LeadFormSheet } from "@/components/crm/lead-form-sheet";
import { LeadTable } from "@/components/crm/lead-table";
import { LostBoard } from "@/components/crm/lost-board";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { STAGE_LABEL } from "@/lib/format";
import { isManager } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Paged } from "@/types/api";
import type { AssignableUser, Lead, StageKey } from "@/types/crm";

type Column = { key: string; label: string; stages: StageKey[]; dropTo: StageKey };
type View = "board" | "table" | "lost";
type Layout = "board" | "table";

// Board columns. Won and Lost each get their own column at the end. (Client projects live in Projects.)
const COLUMNS: Column[] = [
  { key: "new_lead", label: "New Lead", stages: ["new_lead"], dropTo: "new_lead" },
  { key: "connected", label: "Connected", stages: ["connected"], dropTo: "connected" },
  { key: "meeting_scheduled", label: "Meeting Scheduled", stages: ["meeting_scheduled"], dropTo: "meeting_scheduled" },
  { key: "requirement_received", label: "Requirement", stages: ["requirement_received"], dropTo: "requirement_received" },
  { key: "quotation_sent", label: "Quotation Sent", stages: ["quotation_sent"], dropTo: "quotation_sent" },
  { key: "sampling", label: "Sampling", stages: ["sampling"], dropTo: "sampling" },
  { key: "agreement_payment", label: "Agreement & Payment", stages: ["agreement_payment"], dropTo: "agreement_payment" },
  { key: "won", label: "Won", stages: ["closed_won"], dropTo: "closed_won" },
  { key: "lost", label: "Lost", stages: ["closed_lost"], dropTo: "closed_lost" },
];
const VIEW_KEY = "tofaa-leads-view";
const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-36";

/**
 * Leads: one module, two ways to look at the same deals.
 * Board: a column per stage, drag a card to move it. Cards: searchable cards, three per row.
 * New business only: client projects have their own module (Projects).
 */
export default function LeadsPage() {
  const router = useRouter();
  const user = useAppSelector((s) => s.auth.session?.profile);
  const manager = !!user && isManager(user.role);

  const [view, setView] = useState<View>("board");
  const [layout, setLayout] = useState<Layout>("board"); // how the Pipeline tab looks, kept while visiting Lost
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [owner, setOwner] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [callStatus, setCallStatus] = useState("");
  const [tag, setTag] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = useDebounce(search, 300);

  // Start where the person left off; phones start on the table (a 7-column board is too wide for them).
  // Old links: /leads?new=1, /leads?import=1, /pipeline (arrives as ?view=board).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    let saved: View | null = null;
    try { saved = localStorage.getItem(VIEW_KEY) as View | null; } catch { /* storage unavailable */ }
    const known = (v: string | null): View | null => (v === "cards" ? "table" : v === "board" || v === "table" || v === "lost" ? v : null);
    const start = known(p.get("view")) ?? known(saved) ?? (window.innerWidth < 768 ? "table" : "board");
    const savedLayout = known(saved);
    setLayout(start !== "lost" ? start : savedLayout && savedLayout !== "lost" ? savedLayout : "board");
    setView(start);
    if (p.get("pipeline") === "client") { router.replace("/projects"); return; } // client projects moved to Projects
    if (p.get("new") === "1") setAddOpen(true);
    if (p.get("import") === "1") setImportOpen(true);
    if ([...p.keys()].length) window.history.replaceState(null, "", "/leads");
  }, []);

  const chooseLayout = (v: Layout) => {
    setLayout(v);
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };
  const chooseTab = (t: "pipeline" | "lost") => setView(t === "lost" ? "lost" : layout);
  const reset = (fn: () => void) => { fn(); setPage(1); };

  const common = { search: q, source, callOutcome: callStatus || undefined, tag: tag || undefined, ownerId: owner, overdue: overdue || undefined, pipeline: "new_business" };
  const board = useApi<Lead[]>(view !== "table" ? "/leads/board" : null, view === "lost" ? { ...common, overdue: undefined } : common);
  const list = useApi<Paged<Lead>>(view === "table" ? "/leads" : null, { ...common, stage, page, limit: 25 });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reload = () => { void board.reload(); void list.reload(); };
  const actions = useLeadActions(reload);

  const columns = COLUMNS;
  const boardLeads = board.data ?? [];
  const byColumn = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, boardLeads.filter((l) => c.stages.includes(l.stage))])), [boardLeads, columns]);
  const lostLeads = useMemo(() => boardLeads.filter((l) => l.stage === "closed_lost"), [boardLeads]);
  const filtering = !!(q || source || callStatus || tag || owner || (view !== "lost" && overdue) || (view === "table" && stage));
  const active = view === "table" ? list : board;
  const isEmpty = view === "table" ? (list.data?.items.length ?? 0) === 0 : view === "lost" ? lostLeads.length === 0 : boardLeads.length === 0;

  function drop(col: Column) {
    const lead = boardLeads.find((l) => l.id === dragId);
    setDragId(null);
    setOver(null);
    if (!lead || col.stages.includes(lead.stage)) return;
    // Won is set by a confirmed payment, so dropping there explains that (and offers Lost) instead of moving the lead.
    if (col.key === "won") actions.close(leadTarget(lead));
    else if (lead.stage === "closed_lost") actions.reopen(leadTarget(lead), col.dropTo); // the server allows only stages it reached
    else actions.moveTo(leadTarget(lead), col.dropTo);
  }

  const tab = <T extends string>(value: T, current: T, onPick: (v: T) => void, label: string, Icon?: typeof Columns3) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={current === value}
      onClick={() => onPick(value)}
      className={cn("pressable flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium", current === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
    >
      {Icon && <Icon className="h-4 w-4" />} {label}
    </button>
  );
  const addButton = <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add lead</Button>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Leads" />

      {/* tabs on the left; search and the board / table switch on the right */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Leads">
          {tab<"pipeline" | "lost">("pipeline", view === "lost" ? "lost" : "pipeline", chooseTab, "Pipeline", KanbanSquare)}
          {tab<"pipeline" | "lost">("lost", view === "lost" ? "lost" : "pipeline", chooseTab, "Lost", Ban)}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <SearchInput className="min-w-0 flex-1 sm:w-64 sm:flex-none xl:w-72" value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search" />
          {view !== "lost" && (
            <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl border border-slate-300/80 bg-white p-1" role="radiogroup" aria-label="Layout">
              {([["board", "Board view", Columns3], ["table", "Table view", Table2]] as const).map(([v, label, Icon]) => (
                <Tooltip key={v} label={label}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={layout === v}
                    aria-label={label}
                    onClick={() => chooseLayout(v)}
                    className={cn("pressable flex h-8 w-8 items-center justify-center rounded-lg", layout === v ? "bg-brand-soft text-brand" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800")}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                </Tooltip>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* filters on the left, actions on the right */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        {view === "table" && (
          <select className={select} value={stage} onChange={(e) => reset(() => setStage(e.target.value))} aria-label="Stage">
            <option value="">All stages</option>
            {columns.flatMap((c) => c.stages).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        )}
        <select className={select} value={source} onChange={(e) => reset(() => setSource(e.target.value))} aria-label="Source">
          <option value="">All sources</option>
          {(actions.meta?.sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={select} value={callStatus} onChange={(e) => reset(() => setCallStatus(e.target.value))} aria-label="Call status">
          <option value="">All call statuses</option>
          {CALL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={select} value={tag} onChange={(e) => reset(() => setTag(e.target.value))} aria-label="Tag">
          <option value="">All tags</option>
          {TAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {user && (
          <select className={select} value={owner} onChange={(e) => reset(() => setOwner(e.target.value))} aria-label="Owner">
            <option value="">{manager ? "Whole team" : "My deals"}</option>
            {manager && <option value={user.id}>My deals</option>}
            {people.data?.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </select>
        )}
        {view !== "lost" && <button type="button" onClick={() => reset(() => setOverdue((o) => !o))} aria-pressed={overdue} className={cn("pressable h-10 shrink-0 rounded-xl border px-4 text-sm font-medium", overdue ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300/80 bg-white text-slate-600")}>
          Overdue
        </button>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> Import</Button>
          {addButton}
        </div>
      </div>

      {/* content */}
      {active.loading && !active.data && <div className="flex flex-1 items-center justify-center"><Spinner /></div>}
      {active.error && !active.data && <StateView kind="error" message={active.error} onRetry={reload} />}
      {active.data && isEmpty && (
        <StateView
          kind="empty"
          title={filtering ? "Nothing matches" : view === "lost" ? "No lost leads" : "No leads yet"}
          message={filtering ? "Try a different search or clear the filters." : view === "lost" ? "Leads you close as lost show up here, grouped by reason." : "Add your first lead, or import your Excel sheet."}
          action={filtering || view === "lost" ? undefined
            : <><Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> Import</Button>{addButton}</>}
        />
      )}

      {view === "board" && board.data && !isEmpty && (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {columns.map((c) => (
            <div
              key={c.key}
              onDragOver={(e) => { e.preventDefault(); setOver(c.key); }}
              onDragLeave={() => setOver((o) => (o === c.key ? null : o))}
              onDrop={() => drop(c)}
              className={cn("flex min-h-0 min-w-[16.5rem] flex-1 flex-col rounded-2xl bg-slate-100/80 p-2.5", over === c.key && "ring-2 ring-brand/40")}
            >
              <div className="mb-2 flex items-center justify-between gap-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <span className="truncate">{c.label}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-slate-600">{byColumn[c.key].length}</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                {byColumn[c.key].map((l) => <BoardCard key={l.id} lead={l} showOwner={manager} onDragStart={setDragId} onOpen={() => router.push(`/leads/${l.id}`)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "lost" && board.data && !isEmpty && <LostBoard leads={lostLeads} reasons={actions.meta?.lostReasons} showOwner={manager} />}

      {view === "table" && list.data && !isEmpty && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LeadTable leads={list.data.items} canReassign={manager} actions={actions} onEdit={setEditing} />
          {list.data.meta.pages > 1 && (
            <div className="flex items-center justify-between gap-3 pt-4 text-sm text-slate-600">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="truncate">Page {page} of {list.data.meta.pages} · {list.data.meta.total} leads</span>
              <Button variant="secondary" disabled={page >= list.data.meta.pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {editing && <EditLeadSheet lead={editing} meta={actions.meta ?? undefined} open onClose={() => setEditing(null)} onSaved={reload} />}
      <LeadFormSheet open={addOpen} onClose={() => setAddOpen(false)} onCreated={reload} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />
      {actions.sheets}
    </div>
  );
}
