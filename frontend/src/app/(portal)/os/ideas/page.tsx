"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { osAllowed } from "@/components/os/client-gate";
import { IDEA_CATEGORIES, IdeaSheet } from "@/components/os/idea-sheet";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { useDelete } from "@/components/ui/use-delete";
import { todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, loadErrorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { GiftIdea, Ideas } from "@/types/os-modules";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const groupOf = (i: GiftIdea) => (i.startDate ? `${MONTHS[Number(i.startDate.slice(5, 7)) - 1]} ${i.startDate.slice(0, 4)}` : i.category || "No fixed date");
const SELECT = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-56";
const ACTION = "min-h-9 rounded-lg px-3 py-1.5";

/** Every idea (the list is short): the screen groups them by month, as Gifting OS does. */
async function loadAll() {
  const ideas: GiftIdea[] = [];
  let canEdit = false;
  for (let page = 1; page <= 20; page++) {
    const { data } = await apiClient.get<Ideas>("/os/gift-ideas", { params: { page, limit: 100 } });
    ideas.push(...data.items);
    canEdit = !!data.actionsEnabled;
    const total = data.pagination.total_records ?? data.pagination.totalRecords ?? 0;
    if (!data.items.length || ideas.length >= total) break;
  }
  return { ideas, canEdit };
}

/** The gifting calendar: an occasion, what to gift and who to gift it to. The same list for every client; admin edits it. */
export default function GiftIdeasPage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const allowed = osAllowed(role);
  const [data, setData] = useState<{ ideas: GiftIdea[]; canEdit: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [upcomingOnly, setUpcomingOnly] = useState(role !== "admin"); // an admin manages the whole list
  const [editing, setEditing] = useState<GiftIdea | "new" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await loadAll()); } catch (e) { setError(loadErrorMessage(e)); }
  }, []);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  useEffect(() => { if (role && !allowed) router.replace("/dashboard"); }, [role, allowed, router]);
  const remove = useDelete(() => void load());

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayIso();
    const shown = (data?.ideas ?? []).filter((i) =>
      (!category || i.category === category)
      && (!upcomingOnly || !i.startDate || (i.endDate ?? i.startDate) >= today)
      && (!q || `${i.occasion} ${i.giftIdea} ${i.category ?? ""} ${i.giftTo.join(" ")}`.toLowerCase().includes(q)));
    const groups = new Map<string, GiftIdea[]>();
    for (const idea of shown) groups.set(groupOf(idea), [...(groups.get(groupOf(idea)) ?? []), idea]);
    return { total: shown.length, groups: [...groups.entries()] };
  }, [data, search, category, upcomingOnly]);

  if (!allowed) return null;
  const canEdit = !!data?.canEdit;

  return (
    <div className="space-y-6">
      <PageHeader title="Gift Ideas" />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between !mt-0">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <SearchInput className="w-full sm:max-w-xs" value={search} onChange={setSearch} placeholder="Search gift ideas" />
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT}>
            <option value="">All categories</option>
            {IDEA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-slate-900"><input type="checkbox" checked={upcomingOnly} onChange={(e) => setUpcomingOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand" />Upcoming only</label>
        </div>
        {canEdit && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Add gift idea</Button>}
      </div>

      {error && !data ? <StateView kind="error" message={error} onRetry={() => void load()} />
        : !data ? <TableSkeleton columns={4} rows={6} />
          : !sections.total ? <StateView kind="empty" title="No gift ideas found" message={data.ideas.length ? "Try a different search or filter." : "TOFAA will add gift ideas here soon."} />
            : (
              <div className="space-y-8">
                {sections.groups.map(([heading, list]) => (
                  <section key={heading} aria-label={heading}>
                    <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold text-slate-900">{heading}<span className="text-sm font-normal text-slate-500">{list.length} {list.length === 1 ? "idea" : "ideas"}</span></h2>
                    <ul className="space-y-3">
                      {list.map((idea) => (
                        <li key={idea.id} className={cn("flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-start", !idea.isActive && "opacity-70")}>
                          <span className="w-28 shrink-0 text-base font-semibold text-brand sm:pt-0.5">{idea.dateLabel || (idea.startDate ? "" : "No fixed date")}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-semibold text-slate-900">{idea.occasion}</h3>
                              {idea.category && <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">{idea.category}</span>}
                              {!idea.isActive && <span className="rounded-full bg-slate-800/80 px-2.5 py-0.5 text-xs font-medium text-white">Hidden from clients</span>}
                            </div>
                            <p className="mt-0.5 text-sm italic text-slate-500">{idea.giftIdea}</p>
                            {idea.giftTo.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Gift to</span>
                                {idea.giftTo.map((who) => <span key={who} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-900">{who}</span>)}
                              </div>
                            )}
                          </div>
                          {canEdit && (
                            <div className="flex shrink-0 gap-2">
                              <Button variant="secondary" className={ACTION} onClick={() => setEditing(idea)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                              <Button variant="secondary" className={cn(ACTION, "text-rose-700")} aria-label={`Delete ${idea.occasion}`}
                                onClick={() => remove.ask({ path: `/os/gift-ideas/${idea.id}`, title: `Delete ${idea.occasion}?`, done: "Gift idea deleted", message: "It will be removed for every client." })}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
      <IdeaSheet idea={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      {remove.dialog}
    </div>
  );
}
