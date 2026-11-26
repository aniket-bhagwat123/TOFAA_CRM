"use client";
import { UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { errorMessage } from "@/services/api-client";
import type { PeopleGroup, PeopleList, Person } from "@/types/people";
import { mobileText } from "./labels";

/** Pick more people of the group's client to put in an existing group. Only people not in it yet are offered. */
export function AddRecipientsSheet({ group, onClose, onSubmit }: {
  group: PeopleGroup | null;
  onClose: () => void;
  onSubmit: (ids: string[], rows: Person[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [picked, setPicked] = useState<Map<string, Person>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (group) { setSearch(""); setPicked(new Map()); } }, [group?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useApi<PeopleList>(group ? "/people" : null, { companyId: group?.companyId, search: q || undefined, limit: 100, sort: "name" });
  const available = useMemo(() => {
    const inGroup = new Set(group?.recipientIds ?? []);
    return (people.data?.items ?? []).filter((p) => !inGroup.has(p.id));
  }, [group, people.data]);
  const allShown = available.length > 0 && available.every((p) => picked.has(p.id));

  const toggle = (p: Person) => setPicked((m) => { const n = new Map(m); if (n.has(p.id)) n.delete(p.id); else n.set(p.id, p); return n; });
  const toggleShown = () => setPicked((m) => { const n = new Map(m); available.forEach((p) => (allShown ? n.delete(p.id) : n.set(p.id, p))); return n; });

  async function submit() {
    if (!picked.size) return;
    setBusy(true);
    try { await onSubmit([...picked.keys()], [...picked.values()]); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  }

  const loading = people.loading && !people.data;
  return (
    <Sheet open={!!group} title={`Add recipients to “${group?.name ?? ""}”`} subtitle="Only people not in this group yet are listed" icon={UserPlus} tone="indigo" onClose={onClose} width="lg">
      <div className="space-y-4">
        <SearchInput className="sm:w-full" value={search} onChange={setSearch} placeholder="Search by name, mobile or city" />
        <div className="overflow-hidden rounded-xl border border-slate-200">
          {loading ? <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
            : !available.length ? <p className="px-4 py-10 text-center text-sm text-slate-500">{q ? "No people match your search." : (people.data?.items.length ? "Everyone is already in this group." : "This client has no people yet.")}</p>
              : <>
                <label className="flex cursor-pointer items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-800">
                  <input type="checkbox" checked={allShown} onChange={toggleShown} className="h-4 w-4 rounded border-slate-300 text-brand" />
                  {q ? "Select all matches" : "Select all"} ({available.length})
                </label>
                <ul className="max-h-[min(18rem,40vh)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                  {available.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50">
                        <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p)} className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                          <span className="block truncate text-xs text-slate-500">{[mobileText(p.mobileNumber), p.city].filter(Boolean).join(" · ")}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>}
        </div>
        {/* Pinned to the bottom of the dialog, so the buttons never need scrolling to reach. */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-8 flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3 sm:-mb-6">
          <p className="min-w-0 text-sm text-slate-500" aria-live="polite">
            {picked.size ? `${picked.size} selected` : (people.data?.total ?? 0) > 100 && !q ? "First 100 shown. Search to find others." : "Tick the people to add."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button loading={busy} disabled={!picked.size} onClick={() => void submit()}>
              {busy ? "Adding…" : picked.size ? `Add ${picked.size} ${picked.size === 1 ? "recipient" : "recipients"}` : "Add recipients"}
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
