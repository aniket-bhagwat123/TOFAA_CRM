"use client";
import { Archive, ArchiveRestore, Building2, CalendarClock, Download, FileUp, FolderPlus, Heart, MapPin, Plus, Trash2, Upload, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GroupSheet } from "@/components/people/group-sheet";
import { GroupsPanel } from "@/components/people/groups-panel";
import { ImportSheet } from "@/components/people/import-sheet";
import { RELATIONSHIPS, UPCOMING } from "@/components/people/labels";
import { PeopleTable } from "@/components/people/people-table";
import { PersonPanel } from "@/components/people/person-panel";
import { RecipientPanel } from "@/components/people/wizard/recipient-panel";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { FilterMenu } from "@/components/ui/filter-menu";
import { PAGE_SIZE, PAGE_SIZES, Pagination } from "@/components/ui/pagination";
import { useClientFirst } from "@/components/os/client-first";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { downloadFile } from "@/features/media/download";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import { pickedClient } from "@/lib/selected-client";
import { canDeletePeople } from "@/lib/roles";
import type { ClientSummary } from "@/types/crm";
import type { PeopleGroup, PeopleList, PeopleSummary, Person } from "@/types/people";

type SortKey = "name" | "city" | "nextOccasion" | "created";
const PAGE_SIZE_KEY = "people.pageSize";

/** People (KAM and admin): the people at each client who receive gifts, their occasions, addresses and groups. */
export default function PeoplePage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "sales_manager" || role === "kam";

  const [tab, setTab] = useState<"people" | "groups">("people");
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [companyId, setCompanyId] = useState("");
  const [relationship, setRelationship] = useState("");
  const [city, setCity] = useState("");
  const [groupId, setGroupId] = useState("");
  const [upcoming, setUpcoming] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "created", desc: true });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The chosen rows-per-page is remembered on this device.
  useEffect(() => { try { const saved = Number(window.localStorage.getItem(PAGE_SIZE_KEY)); if (PAGE_SIZES.includes(saved)) setPageSize(saved); } catch { /* default is fine */ } }, []);
  const changePageSize = (size: number) => {
    setPageSize(size); setPage(1);
    try { window.localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* not remembered, still applied */ }
  };

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [grouping, setGrouping] = useState<string[] | null>(null); // "New group" from a selection
  const [groupSearch, setGroupSearch] = useState("");             // Groups tab
  const [newGroup, setNewGroup] = useState(false);
  const [busy, setBusy] = useState(false);

  const filters = {
    companyId: companyId || undefined, search: q || undefined, relationship: relationship || undefined, city: city || undefined,
    groupId: groupId || undefined, upcomingDays: upcoming || undefined, status: status || "ACTIVE",
  };
  const mayDelete = canDeletePeople(role);
  const list = useApi<PeopleList>(allowed ? "/people" : null, { ...filters, page, limit: pageSize, sort: sort.key, order: sort.desc ? "desc" : "asc" });
  const summary = useApi<PeopleSummary>(allowed ? "/people/summary" : null, { companyId: companyId || undefined });
  const clients = useApi<ClientSummary[]>(allowed ? "/clients" : null);
  const groups = useApi<PeopleGroup[]>(allowed ? "/people-groups" : null, { companyId: companyId || undefined });

  const accounts = useMemo(() => (clients.data ?? []).filter((c) => !pickedClient() || c.id === pickedClient()!.id).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)), [clients.data]);
  const active = [companyId, relationship, city, groupId, upcoming, status].filter(Boolean).length;

  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, companyId, relationship, city, groupId, upcoming, status, sort]);
  useEffect(() => { setGroupId(""); }, [companyId]);
  if (!allowed) return null;

  const reload = () => { void list.reload(); void summary.reload(); void groups.reload(); };
  const clear = () => { setCompanyId(""); setRelationship(""); setCity(""); setGroupId(""); setUpcoming(""); setStatus(""); };
  const items = list.data?.items ?? [];
  const picked = items.filter((p) => selected.has(p.id));
  const pickedIds = [...selected];
  // Groups hold people of one client, so "Add to group" needs the selection to share an account.
  const pickedCompany = picked.length && picked.every((p) => p.companyId === picked[0].companyId) && picked.length === selected.size ? picked[0].companyId : null;
  // Adding, importing and grouping need one client: ask first when all are shown.
  const inView = companyId || pickedClient()?.id;
  const addAsk = useClientFirst({ active: adding, fixed: inView, accounts, onCancel: () => setAdding(false) });
  const importAsk = useClientFirst({ active: importing, fixed: inView, accounts, onCancel: () => setImporting(false) });
  const groupAsk = useClientFirst({ active: !!grouping, fixed: pickedCompany ?? inView, accounts, onCancel: () => setGrouping(null) });
  const groupChoices = (groups.data ?? []).filter((g) => g.companyId === pickedCompany);

  async function bulkStatus(next: "ACTIVE" | "ARCHIVED", ids = pickedIds) {
    setBusy(true);
    try {
      const res = await apiClient.post<{ affected: number }>("/people/bulk-status", { recipientIds: ids, status: next });
      toast.success(`${res.data.affected} ${res.data.affected === 1 ? "person" : "people"} ${next === "ARCHIVED" ? "archived" : "restored"}`);
      setSelected(new Set()); reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ affected: number }>("/people/bulk-delete", { recipientIds: removing });
      toast.success(`${res.data.affected} ${res.data.affected === 1 ? "person" : "people"} deleted`);
      setRemoving(null); setSelected(new Set()); if (viewing && removing.includes(viewing)) setViewing(null); reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function addToGroup(id: string) {
    if (id === "__new") return setGrouping(pickedIds);
    setBusy(true);
    try {
      await apiClient.put(`/people-groups/${id}`, { addRecipientIds: pickedIds });
      toast.success("Added to the group");
      setSelected(new Set()); reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  const exportParams = (ids?: string[]) => ({ ...filters, format: "xlsx", ...(ids ? { recipientIds: ids.join(",") } : {}) });

  return (
    <div className="space-y-4">
      {/* Row 1: People / Groups on the left; quick filters and actions on the right */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div role="tablist" aria-label="People or groups" className="inline-flex shrink-0 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-card">
          {([["people", "People", summary.data?.active], ["groups", "Groups", groups.data?.length]] as const).map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={cn("pressable flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors", tab === key ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-50")}>
              {key === "people" ? <Users className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}
              {label}{n != null && <span className="tabular-nums">({n})</span>}
            </button>
          ))}
        </div>
        {tab === "people" && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilterMenu icon={<Heart className="h-4 w-4" />} label="Relationship" value={relationship} onChange={setRelationship}
              options={[{ value: "", label: "Relationship" }, ...RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }))]} />
            <FilterMenu icon={<MapPin className="h-4 w-4" />} label="City" searchable value={city} onChange={setCity}
              options={[{ value: "", label: "City" }, ...(summary.data?.cities ?? []).map((c) => ({ value: c, label: c }))]} />
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="h-4 w-4" />Import</Button>
            <Button variant="secondary" onClick={() => void downloadFile("/people/export", exportParams(), "people.xlsx")}><Download className="h-4 w-4" />Export</Button>
            <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add person</Button>
          </div>
        )}
        {tab === "groups" && (
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {accounts.length > 1 && (
              <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Tenant" searchable width={300} value={companyId} onChange={setCompanyId}
                options={[{ value: "", label: "Tenant" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
            )}
            <SearchInput value={groupSearch} onChange={setGroupSearch} placeholder="Search groups" className="min-w-0 flex-1 sm:w-64 sm:flex-none" />
            {(companyId || groupSearch) && (
              <button type="button" onClick={() => { setCompanyId(""); setGroupSearch(""); }}
                className="pressable h-10 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-brand-soft">
                Clear all
              </button>
            )}
            <Button onClick={() => setNewGroup(true)}><Plus className="h-4 w-4" />New group</Button>
          </div>
        )}
      </div>

      {tab === "groups" ? (
        <GroupsPanel companyId={companyId || undefined} accounts={accounts} showAccount={!companyId && accounts.length > 1}
          search={groupSearch} creating={newGroup} onCreateClose={() => setNewGroup(false)} onChanged={() => void groups.reload()} />
      ) : (
        <>
          {/* Row 2: more filters, search and Clear all, in one card (the count is in the footer under the table) */}
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-card">
            {accounts.length > 1 && (
              <FilterMenu icon={<Building2 className="h-4 w-4" />} label="Tenant" searchable width={300} value={companyId} onChange={setCompanyId}
                options={[{ value: "", label: "Tenant" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
            )}
            <FilterMenu icon={<Users className="h-4 w-4" />} label="Group" searchable width={280} value={groupId} onChange={setGroupId}
              options={[{ value: "", label: "Group" }, ...(groups.data ?? []).map((g) => ({
                value: g.id, label: g.name, hint: [`${g.count} ${g.count === 1 ? "person" : "people"}`, !companyId && accounts.length > 1 ? g.accountName : null].filter(Boolean).join(" · "),
              }))]} />
            <FilterMenu icon={<CalendarClock className="h-4 w-4" />} label="Upcoming occasion" value={upcoming} onChange={setUpcoming}
              options={[{ value: "", label: "Upcoming occasion" }, ...UPCOMING]} />
            <FilterMenu icon={<Archive className="h-4 w-4" />} label="Status" value={status} onChange={setStatus}
              options={[{ value: "", label: "Status: Active" }, { value: "ARCHIVED", label: `Status: Archived${summary.data?.archived ? ` (${summary.data.archived})` : ""}` }, { value: "ALL", label: "All" }]} />
            {/* Search takes the rest of the row (up to 18rem) and shrinks before it would wrap onto its own line. */}
            <div className="flex min-w-[15rem] flex-1 items-center justify-end gap-1">
              <SearchInput value={search} onChange={setSearch} placeholder="Search by name, mobile or city…" className="min-w-0 flex-1 sm:w-auto sm:max-w-[18rem]" />
              <button type="button" onClick={() => { clear(); setSearch(""); }} disabled={!active && !search}
                className="pressable h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-semibold text-brand hover:bg-brand-soft disabled:pointer-events-none disabled:opacity-40">
                Clear all
              </button>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-sm">
              <span className="font-medium text-brand">{selected.size} selected</span>
              <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="pressable rounded p-1 text-brand hover:bg-white/60"><X className="h-4 w-4" /></button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {pickedCompany ? (
                  <select aria-label="Add to group" value="" disabled={busy} onChange={(e) => void addToGroup(e.target.value)}
                    className="h-9 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
                    <option value="">Add to group…</option>
                    {groupChoices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    <option value="__new">+ New group</option>
                  </select>
                ) : <span className="text-xs text-slate-500">Pick people of one client to group them</span>}
                <Button variant="secondary" onClick={() => void downloadFile("/people/export", exportParams(pickedIds), "people.xlsx")}><Download className="h-4 w-4" />Export</Button>
                {status === "ARCHIVED"
                  ? <Button variant="secondary" loading={busy} onClick={() => void bulkStatus("ACTIVE")}><ArchiveRestore className="h-4 w-4" />Restore</Button>
                  : <Button variant="secondary" loading={busy} onClick={() => void bulkStatus("ARCHIVED")}><Archive className="h-4 w-4" />Archive</Button>}
                {mayDelete && <Button variant="secondary" className="text-red-600" onClick={() => setRemoving(pickedIds)}><Trash2 className="h-4 w-4" />Delete</Button>}
              </div>
            </div>
          )}

          {list.loading && !list.data && <TableSkeleton columns={6} rows={8} />}
          {list.error && !list.data && <StateView kind="error" message={list.error} onRetry={reload} />}
          {list.data && items.length === 0 && (
            active || q
              ? <StateView kind="empty" title="No one matches" message="Try other filters or clear them." action={<Button variant="secondary" onClick={() => { clear(); setSearch(""); }}>Clear filters</Button>} />
              : <StateView kind="empty" title="No people yet" message="Add the people at your clients who receive gifts, or import them from a spreadsheet."
                  action={<div className="flex gap-2"><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add person</Button><Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" />Import</Button></div>} />
          )}
          {items.length > 0 && (
            <PeopleTable
              people={items}
              showAccount={!companyId && accounts.length > 1}
              selected={selected}
              onToggle={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              onToggleAll={(on) => setSelected((s) => { const n = new Set(s); items.forEach((p) => (on ? n.add(p.id) : n.delete(p.id))); return n; })}
              sort={sort}
              onSort={(key) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === "created" }))}
              onOpen={(p) => setViewing(p.id)}
              onEdit={(p) => setEditing(p)}
              onArchive={(p) => void bulkStatus(p.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED", [p.id])}
              onDelete={mayDelete ? (p) => setRemoving([p.id]) : undefined}
            />
          )}
          {list.data && list.data.total > 0 && (
            <Pagination page={page} pageSize={pageSize} total={list.data.total} loading={list.loading} noun={["person", "people"]}
              onPage={(n) => { setPage(n); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              onPageSize={changePageSize} />
          )}
        </>
      )}

      {addAsk.dialog}{importAsk.dialog}{groupAsk.dialog}
      <RecipientPanel open={(adding && addAsk.ready) || !!editing} person={editing} accounts={editing ? accounts : addAsk.accounts} defaultCompanyId={editing ? companyId || undefined : addAsk.clientId}
        onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => reload()} />
      <PersonPanel personId={viewing} onClose={() => setViewing(null)} onEdit={(p) => setEditing(p)} onChanged={reload} />
      <ImportSheet open={importing && importAsk.ready} accounts={importAsk.accounts} defaultCompanyId={importAsk.clientId} onClose={() => setImporting(false)} onDone={reload} />
      <GroupSheet open={!!grouping && groupAsk.ready} group={null} accounts={groupAsk.accounts} defaultCompanyId={groupAsk.clientId} presetIds={grouping ?? undefined}
        onClose={() => setGrouping(null)} onSaved={() => { setSelected(new Set()); reload(); }} />
      <DeleteDialog open={!!removing} title={removing && removing.length > 1 ? `Delete ${removing.length} people?` : "Delete this person?"}
        message="They leave every list and group. Their history is kept." loading={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}
