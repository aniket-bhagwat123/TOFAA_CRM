"use client";
import { Check, ChevronDown, ChevronRight, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { PeopleGroup, PeopleList, Person } from "@/types/people";
import { AddRecipientsSheet } from "./add-recipients-sheet";
import { GroupSheet } from "./group-sheet";

type Props = {
  companyId?: string; accounts: { id: string; name: string }[]; showAccount: boolean;
  search: string;                     // the "Search groups" box lives in the page's tabs row
  creating: boolean; onCreateClose: () => void; // so does "New group"
  onChanged?: () => void;             // groups were added, changed or deleted (the tab count refreshes)
};
/** The people of one open group, as fetched for exactly the IDs the group had at that moment. */
type Members = { signature: string; status: "loading" | "ready" | "error"; rows: Person[]; error?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IDS_PER_REQUEST = 100; // the most /people returns per page

const shortDate = (v?: string | null) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(v ?? ""); return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : "—"; };
const prettyMobile = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : v || "—"; };
const updatedText = (v?: string | null) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? `Updated ${d.getDate()} ${MONTHS[d.getMonth()]}` : ""; };
const recipients = (n: number) => `${n} ${n === 1 ? "recipient" : "recipients"}`;
const signatureOf = (g: PeopleGroup) => g.recipientIds.join(",");

/** Asks /people for just these IDs, in pages of 100, archived people included. */
async function fetchMembers(ids: string[]): Promise<Person[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) batches.push(ids.slice(i, i + IDS_PER_REQUEST));
  const parts = await Promise.all(batches.map((batch) =>
    apiClient.get<PeopleList>("/people", { params: { recipientIds: batch.join(","), limit: IDS_PER_REQUEST, status: "ALL", sort: "name" } })));
  return parts.flatMap((r) => r.data.items);
}

/** The Groups tab: open a group to see its people, search them, add or remove someone; select groups to delete. */
export function GroupsPanel({ companyId, accounts, showAccount, search, creating, onCreateClose, onChanged }: Props) {
  const groups = useApi<PeopleGroup[]>("/people-groups", { companyId: companyId || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Members>>({});
  const [memberSearch, setMemberSearch] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<PeopleGroup | null>(null); // the group being edited
  const [addingTo, setAddingTo] = useState<PeopleGroup | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ group: PeopleGroup; id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const reload = async () => { await groups.reload(); onChanged?.(); };

  // A new account filter shows other groups: forget what was open, picked or loaded.
  useEffect(() => { setOpen(null); setPicked(new Set()); setMembers({}); setMemberSearch({}); }, [companyId]);

  const list = useMemo(() => groups.data ?? [], [groups.data]);
  const filtered = useMemo(() => { const q = search.trim().toLowerCase(); return q ? list.filter((g) => g.name.toLowerCase().includes(q)) : list; }, [list, search]);
  const uniquePeople = new Set(list.flatMap((g) => g.recipientIds)).size;

  const loadMembers = useCallback(async (group: PeopleGroup) => {
    const signature = signatureOf(group);
    setMembers((c) => ({ ...c, [group.id]: { signature, status: "loading", rows: [] } }));
    try {
      const rows = await fetchMembers(group.recipientIds);
      setMembers((c) => (c[group.id]?.signature === signature ? { ...c, [group.id]: { signature, status: "ready", rows } } : c));
    } catch (e) {
      setMembers((c) => (c[group.id]?.signature === signature ? { ...c, [group.id]: { signature, status: "error", rows: [], error: errorMessage(e) } } : c));
    }
  }, []);

  // A group's people are fetched only once it is opened, and again only if its members change.
  useEffect(() => {
    if (!open) return;
    const group = list.find((g) => g.id === open);
    if (group && members[open]?.signature !== signatureOf(group)) void loadMembers(group);
  }, [open, list, members, loadMembers]);

  // One group open at a time: opening another closes the one that was open.
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const pick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function deleteGroups() {
    if (!picked.size) return;
    setDeleting(true);
    try {
      const ids = [...picked];
      let deleted = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const res = await apiClient.post<{ deleted: number }>("/people-groups/bulk-delete", { groupIds: ids.slice(i, i + 200) });
        deleted += res.data.deleted ?? 0;
      }
      toast.success(`${deleted} ${deleted === 1 ? "group" : "groups"} deleted`);
      setPicked(new Set()); setConfirmDelete(false); await reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setDeleting(false); }
  }

  async function removeMember(group: PeopleGroup, id: string, name: string) {
    setRemoving(id);
    const remaining = group.recipientIds.filter((x) => x !== id);
    try {
      await apiClient.put(`/people-groups/${group.id}`, { recipientIds: remaining });
      // Drop them from what is on screen, so the refreshed group doesn't trigger another fetch.
      setMembers((c) => (c[group.id] ? { ...c, [group.id]: { ...c[group.id], signature: remaining.join(","), rows: c[group.id].rows.filter((r) => r.id !== id) } } : c));
      toast.success(`${name || "Recipient"} removed from ${group.name}`);
      setMemberToRemove(null);
      await reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setRemoving(null); }
  }

  async function addMembers(group: PeopleGroup, ids: string[], rows: Person[]) {
    await apiClient.put(`/people-groups/${group.id}`, { addRecipientIds: ids });
    const next = [...group.recipientIds, ...ids];
    // Show them straight away from what we already have, so the refreshed group doesn't trigger another fetch.
    setMembers((c) => (c[group.id]?.status === "ready" ? { ...c, [group.id]: { ...c[group.id], signature: next.join(","), rows: [...c[group.id].rows, ...rows] } } : c));
    toast.success(`${recipients(ids.length)} added to ${group.name}`);
    setAddingTo(null);
    await reload();
  }

  return (
    <div className="space-y-3">
      {groups.error && !groups.data && <StateView kind="error" message={groups.error} onRetry={() => void reload()} />}

      {!(groups.error && !groups.data) && (
        <section aria-label="Recipient groups" className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
          {picked.size > 0 && (
            <div role="region" aria-label="Selected groups" aria-live="polite" className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-brand-soft/60 px-4 py-2.5 sm:px-6">
              <button type="button" role="checkbox" aria-checked="true" aria-label="Unselect all groups" onClick={() => setPicked(new Set())} className="pressable flex h-5 w-5 items-center justify-center rounded bg-brand text-white"><Check className="h-3.5 w-3.5" strokeWidth={3} /></button>
              <span className="text-xs font-semibold text-slate-900">{picked.size} selected</span>
              {picked.size < filtered.length && <button type="button" onClick={() => setPicked(new Set(filtered.map((g) => g.id)))} className="pressable inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold text-brand hover:bg-white/70">Select all {filtered.length} groups</button>}
              <button type="button" onClick={() => setConfirmDelete(true)} className="pressable inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /> Delete</button>
              <button type="button" aria-label="Clear selection" onClick={() => setPicked(new Set())} className="pressable ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 hover:bg-black/5"><X className="h-4 w-4" /></button>
            </div>
          )}

          {groups.loading && !groups.data ? <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}</div>
            : !filtered.length ? <p className="px-6 py-12 text-center text-sm text-slate-500">{search ? "No groups match your search." : "No groups yet. Create one to gift many people of a client at once."}</p>
              : (
                <ul>
                  {filtered.map((group) => {
                    const expanded = open === group.id;
                    const state = members[group.id];
                    const found = new Map((state?.rows ?? []).map((r) => [r.id, r]));
                    const query = (memberSearch[group.id] ?? "").trim().toLowerCase();
                    const shown = group.recipientIds
                      .map((id) => ({ id, row: found.get(id) }))
                      .filter(({ row }) => !query || (row && `${row.name} ${row.mobileNumber ?? ""} ${row.city ?? ""}`.toLowerCase().includes(query)));
                    const canRemove = group.recipientIds.length > 1;
                    return (
                      <li key={group.id} className="border-t border-slate-200/80 first:border-t-0">
                        <div className="flex items-center hover:bg-slate-50/60">
                          <label className="flex shrink-0 cursor-pointer items-center py-4 pl-4 sm:pl-6">
                            <input type="checkbox" aria-label={`Select ${group.name}`} checked={picked.has(group.id)} onChange={() => pick(group.id)} className="h-4 w-4 rounded border-slate-300 text-brand" />
                          </label>
                          <button type="button" aria-expanded={expanded} onClick={() => toggle(group.id)} className="pressable flex w-full items-center gap-4 px-4 py-4 text-left sm:pr-6">
                            {expanded ? <ChevronDown className="h-5 w-5 shrink-0 text-slate-500" /> : <ChevronRight className="h-5 w-5 shrink-0 text-slate-500" />}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-base font-semibold text-slate-900">{group.name}</span>
                              <span className="block truncate text-sm text-slate-500">{recipients(group.recipientIds.length)}{showAccount && group.accountName ? ` · ${group.accountName}` : ""}</span>
                            </span>
                            <span className="hidden shrink-0 text-sm text-slate-500 sm:block">{updatedText(group.updatedAt ?? group.createdAt)}</span>
                          </button>
                        </div>

                        {expanded && (
                          <div className="space-y-4 px-4 pb-5 sm:px-6 md:pl-[3.7rem]">
                            <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="relative w-full sm:max-w-xs">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <input type="search" value={memberSearch[group.id] ?? ""} onChange={(e) => setMemberSearch((c) => ({ ...c, [group.id]: e.target.value }))}
                                  aria-label={`Search recipients in ${group.name}`} placeholder="Search recipients"
                                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15" />
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <Button className="min-h-[2.25rem] px-3" onClick={() => setAddingTo(group)}><Plus className="h-4 w-4" />Add recipients</Button>
                                <Button variant="secondary" className="min-h-[2.25rem] px-3" onClick={() => setSheet(group)}>Edit group</Button>
                              </div>
                            </div>

                            {!state || state.status === "loading" ? (
                              <div className="space-y-2 rounded-xl border border-slate-200/80 p-4" aria-busy="true">{Array.from({ length: Math.max(1, Math.min(group.recipientIds.length, 4)) }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
                            ) : state.status === "error" ? (
                              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                                <span>We couldn&apos;t load these recipients. {state.error}</span>
                                <Button variant="secondary" onClick={() => void loadMembers(group)}>Try again</Button>
                              </div>
                            ) : !shown.length ? (
                              <p className="rounded-xl border border-slate-200/80 px-4 py-8 text-center text-sm text-slate-500">{query ? "No recipients match your search." : "No one in this group yet."}</p>
                            ) : (
                              <div className="overflow-hidden rounded-xl border border-slate-200/80">
                                <table className="hidden w-full text-sm md:table">
                                  <thead className="bg-slate-50">
                                    <tr className="border-b border-slate-200/80 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      <th className="px-4 py-3">Recipient</th><th className="px-4 py-3">Mobile</th><th className="px-4 py-3">City</th><th className="px-4 py-3">Birthday</th><th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {shown.map(({ id, row }) => (
                                      <tr key={id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/60">
                                        <td className="px-4 py-2.5 font-semibold capitalize text-slate-900">{row ? row.name : <span className="font-normal text-slate-400">Removed recipient</span>}</td>
                                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{prettyMobile(row?.mobileNumber)}</td>
                                        <td className="px-4 py-2.5 text-slate-600">{row?.city || "—"}</td>
                                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-600">{shortDate(row?.dateOfBirth)}</td>
                                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                                          <Button variant="secondary" className="min-h-[2.25rem] px-3 text-red-600" disabled={removing === id || !canRemove} title={canRemove ? undefined : "A group needs at least one recipient"}
                                            aria-label={`Remove ${row?.name ?? "recipient"} from ${group.name}`} onClick={() => setMemberToRemove({ group, id, name: row?.name ?? "" })}>Remove</Button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <ul className="divide-y divide-slate-100 md:hidden">
                                  {shown.map(({ id, row }) => (
                                    <li key={id} className="space-y-3 p-4">
                                      <p className="font-medium capitalize text-slate-900">{row ? row.name : <span className="text-slate-400">Removed recipient</span>}</p>
                                      <dl className="grid grid-cols-3 gap-2 text-sm">
                                        <div><dt className="text-slate-500">Mobile</dt><dd className="font-medium text-slate-900">{prettyMobile(row?.mobileNumber)}</dd></div>
                                        <div><dt className="text-slate-500">City</dt><dd className="font-medium text-slate-900">{row?.city || "—"}</dd></div>
                                        <div><dt className="text-slate-500">Birthday</dt><dd className="font-medium text-slate-900">{shortDate(row?.dateOfBirth)}</dd></div>
                                      </dl>
                                      <Button variant="secondary" className="w-full text-red-600" disabled={removing === id || !canRemove} onClick={() => setMemberToRemove({ group, id, name: row?.name ?? "" })}>Remove</Button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
          {!!list.length && (
            <p className="border-t border-slate-200/80 px-4 py-3 text-sm text-slate-500 sm:px-6" aria-live="polite">
              {filtered.length < list.length ? `${filtered.length} of ` : ""}{list.length} {list.length === 1 ? "group" : "groups"} · {recipients(uniquePeople)}
            </p>
          )}
        </section>
      )}

      <GroupSheet open={!!sheet || creating} group={sheet} accounts={accounts} defaultCompanyId={companyId}
        onClose={() => { setSheet(null); onCreateClose(); }} onSaved={() => void reload()} onDeleted={() => { setOpen(null); void reload(); }} />
      <AddRecipientsSheet group={addingTo} onClose={() => setAddingTo(null)} onSubmit={(ids, rows) => addMembers(addingTo!, ids, rows)} />
      <DeleteDialog open={!!memberToRemove} title="Remove" confirmLabel="Yes, remove" loading={!!memberToRemove && removing === memberToRemove.id}
        message={`Are you sure you want to remove ${memberToRemove?.name || "this recipient"} from ${memberToRemove?.group.name ?? "this group"}? They stay in the client's people.`}
        onConfirm={() => { const m = memberToRemove; if (m) void removeMember(m.group, m.id, m.name); }} onCancel={() => setMemberToRemove(null)} />
      <DeleteDialog open={confirmDelete} title={picked.size === 1 ? "Delete this group?" : `Delete ${picked.size} groups?`} loading={deleting}
        message={`The people in ${picked.size === 1 ? "it" : "them"} stay; only the ${picked.size === 1 ? "group is" : "groups are"} removed.`}
        onConfirm={() => void deleteGroups()} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
