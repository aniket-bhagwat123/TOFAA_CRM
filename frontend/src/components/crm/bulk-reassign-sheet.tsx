"use client";
import { UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { AssignableUser } from "@/types/crm";

const ROLE_LABEL: Record<string, string> = { sales_executive: "Sales executive", sales_manager: "Sales manager" };

/** How many of `total` leads each of `people` gets when they are dealt out in turn. */
const shares = (total: number, people: number) => Array.from({ length: people }, (_, i) => Math.floor(total / people) + (i < total % people ? 1 : 0));

type Result = { reassigned: number; unchanged: number; missing: number };
type Props = { leadIds: string[] | null; onClose: () => void; onDone: () => void };

/** Hand many leads to one person, or share them equally between several. */
export function BulkReassignSheet({ leadIds, onClose, onDone }: Props) {
  const open = !!leadIds;
  const users = useApi<AssignableUser[]>(open ? "/users/assignable" : null);
  const [picked, setPicked] = useState<string[]>([]); // in the order chosen: the first gets any extra lead
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPicked([]); setSearch(""); setNote(""); setError(""); } }, [open]);

  const total = leadIds?.length ?? 0;
  const people = (users.data ?? []).filter((u) => u.role in ROLE_LABEL); // lead owners: sales executives and managers
  const shown = people.filter((u) => (u.fullName ?? "").toLowerCase().includes(search.trim().toLowerCase()));
  const split = shares(total, picked.length || 1);
  const toggle = (id: string) => { setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setError(""); };

  async function save() {
    if (!leadIds) return;
    if (!picked.length) return setError("Choose at least one person.");
    setBusy(true);
    try {
      const res = await apiClient.post<Result>("/leads/bulk-reassign", { leadIds, ownerIds: picked, note: note.trim() || undefined }, { timeout: 60_000 });
      const { reassigned, unchanged, missing } = res.data;
      const extra = [unchanged && `${unchanged} already with that person`, missing && `${missing} no longer available`].filter(Boolean).join(", ");
      toast.success(`${reassigned} ${reassigned === 1 ? "lead" : "leads"} reassigned${extra ? ` (${extra})` : ""}`);
      onClose();
      onDone();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} title={`Reassign ${total} ${total === 1 ? "lead" : "leads"}`} subtitle="Choose one person, or several to share them equally" icon={UserCog} tone="sky" onClose={onClose} width="lg">
      <div className="space-y-4">
        <SearchInput className="sm:w-full" value={search} onChange={setSearch} placeholder="Search people" />
        <ul className="max-h-[min(18rem,35vh)] divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-200">
          {shown.map((u) => {
            const at = picked.indexOf(u.id);
            return (
              <li key={u.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={at >= 0} onChange={() => toggle(u.id)} className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{u.fullName ?? "Unnamed"}</span>
                    <span className="block text-xs text-slate-500">{ROLE_LABEL[u.role]}</span>
                  </span>
                  {at >= 0 && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{split[at]} {split[at] === 1 ? "lead" : "leads"}</span>}
                </label>
              </li>
            );
          })}
          {users.loading && !users.data && <li className="px-3 py-4 text-center text-sm text-slate-400">Loading…</li>}
          {users.data && !shown.length && <li className="px-3 py-4 text-center text-sm text-slate-400">No people match.</li>}
        </ul>
        {users.error && <p role="alert" className="text-sm text-red-600">{users.error}</p>}
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">Note (optional)</span>
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-xl border border-slate-300/80 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15" />
        </label>
        <p className="text-xs text-slate-500">Open tasks and scheduled meetings move with each lead. Every change is logged.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {/* Pinned to the bottom of the dialog, so the buttons never need scrolling to reach. */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-8 flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3 sm:-mb-6">
          <p className="min-w-0 text-sm text-slate-500" aria-live="polite">{picked.length ? `${picked.length} ${picked.length === 1 ? "person" : "people"} chosen` : "No one chosen"}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button loading={busy} disabled={!picked.length} onClick={() => void save()}>Reassign</Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
