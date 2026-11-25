"use client";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { PeopleGroup, PeopleList } from "@/types/people";
import { GroupSheet } from "./group-sheet";
import { mobileText } from "./labels";

type Props = { companyId?: string; accounts: { id: string; name: string }[]; showAccount: boolean };

/** The Groups tab: every group, open one to see and remove its people, rename, delete (one or many). */
export function GroupsPanel({ companyId, accounts, showAccount }: Props) {
  const groups = useApi<PeopleGroup[]>("/people-groups", { companyId: companyId || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<PeopleGroup | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = () => void groups.reload();

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ deleted: number }>("/people-groups/bulk-delete", { groupIds: removing });
      toast.success(`${res.data.deleted} ${res.data.deleted === 1 ? "group" : "groups"} deleted`);
      setRemoving(null); setSelected(new Set()); reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  const list = groups.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-meta">{list.length} {list.length === 1 ? "group" : "groups"}{selected.size ? ` · ${selected.size} selected` : ""}</p>
        <div className="flex gap-2">
          {selected.size > 0 && <Button variant="secondary" className="text-red-600" onClick={() => setRemoving([...selected])}><Trash2 className="h-4 w-4" />Delete selected</Button>}
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New group</Button>
        </div>
      </div>
      {groups.loading && !groups.data && <div className="flex justify-center py-12"><Spinner /></div>}
      {groups.error && !groups.data && <StateView kind="error" message={groups.error} onRetry={reload} />}
      {groups.data && list.length === 0 && <StateView kind="empty" title="No groups yet" message="Groups let you gift many people of a client at once." action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New group</Button>} />}
      <ul className="space-y-2">
        {list.map((g) => (
          <li key={g.id} className="rounded-2xl border border-slate-200/80 bg-white shadow-card">
            <div className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" aria-label={`Select ${g.name}`} checked={selected.has(g.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} className="h-4 w-4 rounded border-slate-300 text-brand" />
              <button type="button" onClick={() => setOpen((o) => (o === g.id ? null : g.id))} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open === g.id}>
                {open === g.id ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                <span className="truncate font-semibold text-slate-900">{g.name}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{g.count} {g.count === 1 ? "person" : "people"}</span>
                {showAccount && g.accountName && <span className="truncate text-xs text-slate-500">· {g.accountName}</span>}
              </button>
              <button type="button" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
              <button type="button" aria-label={`Delete ${g.name}`} onClick={() => setRemoving([g.id])} className="pressable rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
            {open === g.id && <Members group={g} onChanged={reload} />}
          </li>
        ))}
      </ul>
      <GroupSheet open={adding || !!editing} group={editing} accounts={accounts} defaultCompanyId={companyId} onClose={() => { setAdding(false); setEditing(null); }} onSaved={reload} />
      <DeleteDialog open={!!removing} title={removing && removing.length > 1 ? `Delete ${removing.length} groups?` : "Delete this group?"} message="The people stay; only the group is removed." loading={busy}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}

function Members({ group, onChanged }: { group: PeopleGroup; onChanged: () => void }) {
  const ids = group.recipientIds;
  const people = useApi<PeopleList>(ids.length ? "/people" : null, { recipientIds: ids.slice(0, 100).join(","), limit: 100, status: "ALL", sort: "name" });
  async function drop(id: string) {
    try {
      await apiClient.put(`/people-groups/${group.id}`, { recipientIds: ids.filter((x) => x !== id) });
      toast.success("Removed from the group");
      onChanged();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  if (!ids.length) return <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-400">No one in this group yet.</p>;
  return (
    <ul className="divide-y divide-slate-100 border-t border-slate-100">
      {people.loading && !people.data && <li className="flex justify-center py-4"><Spinner /></li>}
      {people.data?.items.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-slate-800">{p.name}</span>
          <span className="text-xs text-slate-400">{mobileText(p.mobileNumber)}</span>
          <button type="button" aria-label={`Remove ${p.name} from the group`} onClick={() => void drop(p.id)} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><UserMinus className="h-4 w-4" /></button>
        </li>
      ))}
      {ids.length > 100 && <li className="px-4 py-2 text-xs text-slate-400">Showing the first 100 of {ids.length}.</li>}
    </ul>
  );
}
