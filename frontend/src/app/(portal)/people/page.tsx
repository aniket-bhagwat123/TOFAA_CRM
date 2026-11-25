"use client";
import { Archive, ArchiveRestore, Download, FileUp, FolderPlus, Plus, Trash2, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GroupSheet } from "@/components/people/group-sheet";
import { GroupsPanel } from "@/components/people/groups-panel";
import { ImportSheet } from "@/components/people/import-sheet";
import { RELATIONSHIPS, UPCOMING } from "@/components/people/labels";
import { PeopleTable } from "@/components/people/people-table";
import { PersonPanel } from "@/components/people/person-panel";
import { PersonSheet } from "@/components/people/person-sheet";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { ClearFilters, FilterLabel, FilterSelect } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { downloadFile } from "@/features/media/download";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { ClientSummary } from "@/types/crm";
import type { PeopleGroup, PeopleList, PeopleSummary, Person } from "@/types/people";

type SortKey = "name" | "city" | "nextOccasion" | "created";
const LIMIT = 25;
const STATUSES = [{ value: "ARCHIVED", label: "Archived" }, { value: "ALL", label: "Active + archived" }];

/** People (KAM and admin): the people at each client who receive gifts, their occasions, addresses and groups. */
export default function PeoplePage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = role === "admin" || role === "kam";

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [grouping, setGrouping] = useState<string[] | null>(null); // "New group" from a selection
  const [busy, setBusy] = useState(false);

  const filters = {
    companyId: companyId || undefined, search: q || undefined, relationship: relationship || undefined, city: city || undefined,
    groupId: groupId || undefined, upcomingDays: upcoming || undefined, status: status || "ACTIVE",
  };
  const list = useApi<PeopleList>(allowed ? "/people" : null, { ...filters, page, limit: LIMIT, sort: sort.key, order: sort.desc ? "desc" : "asc" });
  const summary = useApi<PeopleSummary>(allowed ? "/people/summary" : null, { companyId: companyId || undefined });
  const clients = useApi<ClientSummary[]>(allowed ? "/clients" : null);
  const groups = useApi<PeopleGroup[]>(allowed ? "/people-groups" : null, { companyId: companyId || undefined });

  const accounts = useMemo(() => (clients.data ?? []).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)), [clients.data]);
  const active = [companyId, relationship, city, groupId, upcoming, status].filter(Boolean).length;

  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, companyId, relationship, city, groupId, upcoming, status, sort]);
  useEffect(() => { setGroupId(""); }, [companyId]);
  if (!allowed) return null;

  const reload = () => { void list.reload(); void summary.reload(); void groups.reload(); };
  const clear = () => { setCompanyId(""); setRelationship(""); setCity(""); setGroupId(""); setUpcoming(""); setStatus(""); };
  const items = list.data?.items ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / LIMIT)) : 1;
  const picked = items.filter((p) => selected.has(p.id));
  const pickedIds = [...selected];
  // Groups hold people of one client, so "Add to group" needs the selection to share an account.
  const pickedCompany = picked.length && picked.every((p) => p.companyId === picked[0].companyId) && picked.length === selected.size ? picked[0].companyId : null;
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
      <div role="tablist" aria-label="People or groups" className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {([["people", "People", summary.data?.active], ["groups", "Groups", groups.data?.length]] as const).map(([key, label, n]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn("pressable flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium", tab === key ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-50")}>
            {key === "people" ? <Users className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}{label}
            {n != null && <span className="rounded-full bg-white/80 px-1.5 text-xs tabular-nums text-slate-500">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "groups" ? (
        <div className="space-y-3">
          {accounts.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <FilterLabel />
              <FilterSelect label="Client account" value={companyId} onChange={setCompanyId} all="All accounts" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
            </div>
          )}
          <GroupsPanel companyId={companyId || undefined} accounts={accounts} showAccount={!companyId && accounts.length > 1} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, mobile, email, city" className="sm:w-72" />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" />Import</Button>
              <Button variant="secondary" onClick={() => void downloadFile("/people/export", exportParams(), "people.xlsx")}><Download className="h-4 w-4" />Export</Button>
              <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add person</Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterLabel />
            {accounts.length > 1 && <FilterSelect label="Client account" value={companyId} onChange={setCompanyId} all="All accounts" options={accounts.map((a) => ({ value: a.id, label: a.name }))} />}
            <FilterSelect label="Relationship" value={relationship} onChange={setRelationship} all="All relationships" options={RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }))} />
            <FilterSelect label="City" value={city} onChange={setCity} all="All cities" options={(summary.data?.cities ?? []).map((c) => ({ value: c, label: c }))} />
            {!!groups.data?.length && <FilterSelect label="Group" value={groupId} onChange={setGroupId} all="All groups" options={groups.data.map((g) => ({ value: g.id, label: g.name }))} />}
            <FilterSelect label="Upcoming occasion" value={upcoming} onChange={setUpcoming} all="Any occasion" options={UPCOMING} />
            <FilterSelect label="Status" value={status} onChange={setStatus} all="Active" options={STATUSES} />
            <ClearFilters count={active} onClear={clear} />
            {list.data && <span className="t-meta ml-auto">{list.data.total} {list.data.total === 1 ? "person" : "people"}</span>}
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
                <Button variant="secondary" className="text-red-600" onClick={() => setRemoving(pickedIds)}><Trash2 className="h-4 w-4" />Delete</Button>
              </div>
            </div>
          )}

          {list.loading && !list.data && <div className="flex justify-center py-12"><Spinner /></div>}
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
              onDelete={(p) => setRemoving([p.id])}
            />
          )}
          {list.data && pages > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {page} of {pages} · {list.data.total} people</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      )}

      <PersonSheet open={adding || !!editing} person={editing} accounts={accounts} defaultCompanyId={companyId || undefined}
        onClose={() => { setAdding(false); setEditing(null); }} onSaved={() => reload()} />
      <PersonPanel personId={viewing} onClose={() => setViewing(null)} onEdit={(p) => setEditing(p)} onChanged={reload} />
      <ImportSheet open={importing} accounts={accounts} defaultCompanyId={companyId || undefined} onClose={() => setImporting(false)} onDone={reload} />
      <GroupSheet open={!!grouping} group={null} accounts={accounts} defaultCompanyId={pickedCompany ?? undefined} presetIds={grouping ?? undefined}
        onClose={() => setGrouping(null)} onSaved={() => { setSelected(new Set()); reload(); }} />
      <DeleteDialog open={!!removing} title={removing && removing.length > 1 ? `Delete ${removing.length} people?` : "Delete this person?"}
        message="They leave every list and group. Their history is kept." loading={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}
