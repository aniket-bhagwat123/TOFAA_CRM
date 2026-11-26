"use client";
import { FileUp, Plus, UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BoardCard } from "@/components/crm/board-card";
import { BulkReassignSheet } from "@/components/crm/bulk-reassign-sheet";
import { CALL_STATUS_OPTIONS, TAG_OPTIONS } from "@/components/crm/call-status-badge";
import { EditLeadSheet } from "@/components/crm/edit-lead-sheet";
import { ImportModal } from "@/components/crm/import-modal";
import { leadTarget } from "@/components/crm/lead-card";
import { LeadFormSheet } from "@/components/crm/lead-form-sheet";
import { LeadTable } from "@/components/crm/lead-table";
import { useLeadActions } from "@/components/crm/use-lead-actions";
import { Button } from "@/components/ui/button";
import { ClearFilters, FilterLabel, FilterSelect, FilterToggle } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { BOARD_TABLE, ViewToggle } from "@/components/ui/view-toggle";
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
type View = "board" | "table";
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

const MAX_BULK = 200; // the most leads one bulk reassign accepts
// The dropdowns share the filter row's width equally, so Overdue stays on the same line; narrow screens still wrap.
const FIT = "sm:min-w-[7.5rem] sm:flex-1 sm:basis-0 sm:pl-3 sm:pr-7";

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
  const [layout, setLayout] = useState<Layout>("board");
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
  const [selected, setSelected] = useState<Set<string>>(new Set()); // managers, table view; kept across pages
  const [reassigning, setReassigning] = useState<string[] | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = useDebounce(search, 300);

  // Start where the person left off; phones start on the table (a 7-column board is too wide for them).
  // Old links: /leads?new=1, /leads?import=1, /pipeline (arrives as ?view=board).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    let saved: View | null = null;
    try { saved = localStorage.getItem(VIEW_KEY) as View | null; } catch { /* storage unavailable */ }
    // "lost" was a view once (the Lost tab, removed): old links and saved choices fall back to the board
    const known = (v: string | null): View | null => (v === "cards" ? "table" : v === "board" || v === "table" ? v : v === "lost" ? "board" : null);
    const start = known(p.get("view")) ?? known(saved) ?? (window.innerWidth < 768 ? "table" : "board");
    setLayout(start);
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
  const reset = (fn: () => void) => { fn(); setPage(1); };

  const common = { search: q, source, callOutcome: callStatus || undefined, tag: tag || undefined, ownerId: owner, overdue: overdue || undefined, pipeline: "new_business" };
  const board = useApi<Lead[]>(view === "board" ? "/leads/board" : null, common);
  const list = useApi<Paged<Lead>>(view === "table" ? "/leads" : null, { ...common, stage, page, limit: 25 });
  const people = useApi<AssignableUser[]>(manager ? "/users/assignable" : null);
  const reload = () => { void board.reload(); void list.reload(); };
  const actions = useLeadActions(reload);

  // Other filters (or the board) show other leads: nothing stays selected out of sight.
  useEffect(() => { setSelected(new Set()); }, [q, stage, source, callStatus, tag, owner, overdue, view]);
  const choose = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    if (next.size > MAX_BULK) return void toast.error(`You can select up to ${MAX_BULK} leads at a time.`);
    setSelected(next);
  };
  const selection = manager ? { ids: selected, toggle: (id: string) => choose([id], !selected.has(id)), setMany: choose } : undefined;

  const columns = COLUMNS;
  const boardLeads = board.data ?? [];
  const byColumn = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, boardLeads.filter((l) => c.stages.includes(l.stage))])), [boardLeads, columns]);
  const filtering = !!(q || source || callStatus || tag || owner || overdue || (view === "table" && stage));
  const activeFilters = [q, source, callStatus, tag, owner, overdue ? "1" : "", view === "table" ? stage : ""].filter(Boolean).length;
  const shown = view === "table" ? list.data?.meta.total : board.data?.length;
  const active = view === "table" ? list : board;
  const isEmpty = view === "table" ? (list.data?.items.length ?? 0) === 0 : boardLeads.length === 0;

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

  const addButton = <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add lead</Button>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Leads" />

      {/* Row 1: search on the left; layout switch, Import and Add lead on the right */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="min-w-0 flex-1 sm:max-w-sm" value={search} onChange={(v) => reset(() => setSearch(v))} placeholder="Search company, contact, phone" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ViewToggle value={layout} onChange={chooseLayout} options={BOARD_TABLE} />
          <Button variant="secondary" className="shrink-0" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /><span className="hidden sm:inline">Import</span></Button>
          {addButton}
        </div>
      </div>

      {/* Row 2: filters (an active one turns blue), Clear, and how many leads are shown */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterLabel />
        {view === "table" && (
          <FilterSelect className={FIT} label="Stage" all="All stages" value={stage} onChange={(v) => reset(() => setStage(v))}
            options={columns.flatMap((c) => c.stages).map((s) => ({ value: s, label: STAGE_LABEL[s] }))} />
        )}
        <FilterSelect className={FIT} label="Source" all="All sources" value={source} onChange={(v) => reset(() => setSource(v))}
          options={(actions.meta?.sources ?? []).map((s) => ({ value: s, label: s }))} />
        <FilterSelect className={cn(FIT, "sm:grow-[1.35]")} label="Call status" all="All call statuses" value={callStatus} onChange={(v) => reset(() => setCallStatus(v))} options={CALL_STATUS_OPTIONS} />
        <FilterSelect className={FIT} label="Tag" all="All tags" value={tag} onChange={(v) => reset(() => setTag(v))} options={TAG_OPTIONS} />
        {manager && user && (
          <FilterSelect className={FIT} label="Owner" all="Whole team" value={owner} onChange={(v) => reset(() => setOwner(v))}
            options={[{ value: user.id, label: "My deals" }, ...(people.data ?? []).filter((p) => p.id !== user.id).map((p) => ({ value: p.id, label: p.fullName ?? "Unnamed" }))]} />
        )}
        <FilterToggle on={overdue} onChange={(on) => reset(() => setOverdue(on))} tone="red">Overdue</FilterToggle>
        <ClearFilters count={activeFilters} onClear={() => reset(() => { setSearch(""); setStage(""); setSource(""); setCallStatus(""); setTag(""); setOwner(""); setOverdue(false); })} />
        {shown != null && <span className="t-meta ml-auto whitespace-nowrap">{shown} {shown === 1 ? "lead" : "leads"}</span>}
      </div>

      {/* content */}
      {active.loading && !active.data && <div className="flex flex-1 items-center justify-center"><Spinner /></div>}
      {active.error && !active.data && <StateView kind="error" message={active.error} onRetry={reload} />}
      {active.data && isEmpty && (
        <StateView
          kind="empty"
          title={filtering ? "Nothing matches" : "No leads yet"}
          message={filtering ? "Try a different search or clear the filters." : "Add your first lead, or import your Excel sheet."}
          action={filtering ? undefined
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

      {view === "table" && list.data && !isEmpty && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected.size > 0 && (
            <div role="region" aria-label="Selected leads" aria-live="polite" className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
              <span className="font-medium text-brand">{selected.size} selected</span>
              <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="pressable rounded p-1 text-brand hover:bg-white/60"><X className="h-4 w-4" /></button>
              <Button className="ml-auto" onClick={() => setReassigning([...selected])}><UserCog className="h-4 w-4" /> Reassign</Button>
            </div>
          )}
          <LeadTable leads={list.data.items} canReassign={manager} actions={actions} onEdit={setEditing} selection={selection} />
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
      <BulkReassignSheet leadIds={reassigning} onClose={() => setReassigning(null)} onDone={() => { setSelected(new Set()); reload(); }} />
      {actions.sheets}
    </div>
  );
}
