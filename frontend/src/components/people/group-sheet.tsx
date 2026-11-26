"use client";
import { Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { InputField } from "@/components/ui/input-field";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { fieldErrors } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";
import type { PeopleGroup, PeopleList } from "@/types/people";
import { mobileText } from "./labels";

type Props = {
  open: boolean;
  group: PeopleGroup | null;          // editing; null = new
  accounts: { id: string; name: string }[];
  defaultCompanyId?: string;
  presetIds?: string[];               // "New group" from a selection
  onClose: () => void;
  onSaved: (g: PeopleGroup) => void;
  onDeleted?: () => void;             // shows "Delete group" when editing
};

/** Create or edit a group: a name and the people in it, all from one client. */
export function GroupSheet({ open, group, accounts, defaultCompanyId, presetIds, onClose, onSaved, onDeleted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // id -> name
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const people = useApi<PeopleList>(open && companyId ? "/people" : null, { companyId, search: q || undefined, limit: 50, sort: "name" });
  const known = useApi<PeopleList>(open && companyId && (group?.recipientIds.length || presetIds?.length) ? "/people" : null,
    { companyId, recipientIds: (group?.recipientIds ?? presetIds ?? []).slice(0, 100).join(","), limit: 100, status: "ALL" });

  useEffect(() => {
    if (!open) return;
    setErrors({}); setSearch(""); setConfirmDelete(false);
    setName(group?.name ?? "");
    setCompanyId(group?.companyId ?? defaultCompanyId ?? (accounts.length === 1 ? accounts[0].id : ""));
    setPicked(new Map((group?.recipientIds ?? presetIds ?? []).map((id) => [id, ""])));
  }, [open, group, defaultCompanyId, accounts, presetIds]);
  useEffect(() => { // fill in the names of people already in the group
    const items = known.data?.items;
    if (items?.length) setPicked((m) => new Map([...m].map(([id, n]) => [id, n || items.find((p) => p.id === id)?.name || "…"])));
  }, [known.data]);

  const toggle = (id: string, label: string) => {
    setPicked((m) => { const n = new Map(m); if (n.has(id)) n.delete(id); else n.set(id, label); return n; });
    setErrors((x) => ({ ...x, recipientIds: "" }));
  };

  async function remove() {
    if (!group) return;
    setBusy(true);
    try {
      await apiClient.delete(`/people-groups/${group.id}`);
      toast.success("Group deleted");
      setConfirmDelete(false);
      onClose();
      onDeleted?.();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Enter a group name";
    if (!companyId) e.companyId = "Pick the client account";
    else if (!picked.size) e.recipientIds = "Choose at least one person";
    if (Object.keys(e).length) return setErrors(e);
    setBusy(true);
    try {
      const ids = [...picked.keys()];
      const res = group
        ? await apiClient.put<PeopleGroup>(`/people-groups/${group.id}`, { name: name.trim(), recipientIds: ids })
        : await apiClient.post<PeopleGroup>("/people-groups", { companyId, name: name.trim(), recipientIds: ids });
      toast.success("Group saved");
      onClose();
      onSaved(res.data);
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe); else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title={group ? "Edit group" : "New group"} subtitle="People of one client, to gift together" icon={Users} tone="indigo" onClose={onClose} width="lg">
      <div className="space-y-4">
        <InputField label="Group name" required maxLength={120} value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: "" })); }} error={errors.name} />
        {!group && accounts.length > 1 && (
          <SelectField label="Client account" required placeholder="Select" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPicked(new Map()); }}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={errors.companyId} />
        )}
        {companyId && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-700">People</span><span className="text-xs text-slate-500">{picked.size} selected</span></div>
            {picked.size > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[...picked].map(([id, n]) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                    {n || "…"}<button type="button" aria-label={`Remove ${n}`} onClick={() => toggle(id, n)}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <SearchInput className="sm:w-full" value={search} onChange={setSearch} placeholder="Search people to add" />
            <ul className="max-h-[min(16rem,35vh)] overscroll-contain divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {(people.data?.items ?? []).map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id, p.name)} className="h-4 w-4 rounded border-slate-300 text-brand" />
                    <span className="min-w-0 flex-1 truncate text-slate-800">{p.name}</span>
                    <span className="text-xs text-slate-400">{mobileText(p.mobileNumber)}</span>
                  </label>
                </li>
              ))}
              {people.data && people.data.items.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-400">No people match.</li>}
            </ul>
            {errors.recipientIds && <p role="alert" className="text-sm text-red-600">{errors.recipientIds}</p>}
          </div>
        )}
        {/* Pinned to the bottom of the dialog, so the buttons never need scrolling to reach. */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-8 flex items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:-mb-6">
          {group && onDeleted
            ? <Button variant="ghost" className="px-2 text-red-600 hover:bg-red-50" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete group</Button>
            : <span />}
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} loading={busy}>{group ? "Save changes" : "Create group"}</Button>
          </div>
        </div>
      </div>
      <DeleteDialog open={confirmDelete} title="Delete this group?" loading={busy}
        message={`“${group?.name ?? ""}” will be deleted. The people stay; only the group is removed.`}
        onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} />
    </Sheet>
  );
}
