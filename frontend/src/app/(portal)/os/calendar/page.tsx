"use client";
/**
 * The client's Gift Calendar, laid out like Gifting OS's: a month calendar or a list of every important date, with what
 * to do next for each. Gifting OS gives the CRM planning status for the next 90 days; the calendar fills other days of a
 * month from its Home calendar.
 */
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, List as ListIcon, MoreVertical, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RequestWizard, type RequestStart } from "@/components/gifting/request-wizard";
import { metaOf } from "@/components/gifting/shared";
import { actionFor, countdownText, fromCalendarDay, fullDay, isoOf, kindMeta, StatusPill, Subject, WINDOW_DAYS, type ActionKind } from "@/components/os/calendar/meta";
import { MonthGrid } from "@/components/os/calendar/month-grid";
import { OccasionDetails } from "@/components/os/calendar/occasion-details";
import { OccasionForm } from "@/components/os/calendar/occasion-form";
import { useClientFirst } from "@/components/os/client-first";
import { ALL_CLIENTS, ClientGate } from "@/components/os/client-gate";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet } from "@/components/ui/sheet";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDelete } from "@/components/ui/use-delete";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/store/hooks";
import type { Occasions, OsCalendar, OsHome, OverviewItem } from "@/types/os-modules";

const TABS = [["ALL", "All"], ["NOT_PLANNED", "Not Planned"], ["BUDGET_ALLOCATED", "Budget Allocated"], ["REQUEST_SUBMITTED", "Request Submitted"], ["IN_PROGRESS", "In Progress"], ["DELIVERED", "Delivered"]] as const;
const SORTS = [["soonest", "Soonest first"], ["priority", "Priority"], ["name", "Recipient name"]] as const;
const RANGES = ["30", "60", String(WINDOW_DAYS)];
const RANK = { VIP: 0, HIGH: 1, NORMAL: 2 };
const FETCH = 500; // the most dates Gifting OS sends at once
const VIEW_KEY = "tofaa-os-calendar-view";
const select = "h-10 cursor-pointer rounded-xl border border-slate-300/80 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-brand focus:ring-4 focus:ring-brand/15";
const arrow = "pressable flex h-9 w-9 items-center justify-center rounded-full border border-slate-300/80 bg-white";

export default function GiftCalendarPage() {
  return (
    <>
      <PageHeader title="Gift Calendar" />
      <ClientGate>{(companyId) => <Calendar companyId={companyId} />}</ClientGate>
    </>
  );
}

function Calendar({ companyId }: { companyId: string }) {
  const router = useRouter();
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [range, setRange] = useState(String(WINDOW_DAYS));
  const [tab, setTab] = useState("ALL");
  const [sort, setSort] = useState("soonest");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OverviewItem | null>(null);
  const [form, setForm] = useState<{ item: OverviewItem | null; date?: string } | null>(null);
  const [warn, setWarn] = useState<OverviewItem | null>(null);
  const [starting, setStarting] = useState<RequestStart | null>(null);
  const q = useDebounce(search, 300).trim();
  useEffect(() => { try { if (window.localStorage.getItem(VIEW_KEY) === "list") setView("list"); } catch { /* storage unavailable */ } }, []);
  const choose = (next: "calendar" | "list") => { setView(next); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* not remembered */ } };

  const monthKey = isoOf(month).slice(0, 7);
  const dates = useApi<OsCalendar>(`/os/${companyId}/calendar`, { q: q || undefined, tab: "ALL", limit: FETCH });
  const grid = useApi<OsHome>(view === "calendar" ? `/os/${companyId}/home` : null, { month: monthKey, category: "ALL" });
  const occasions = useApi<Occasions>(`/os/${companyId}/occasions`, { limit: 100 });
  const reload = () => { void dates.reload(); void grid.reload(); void occasions.reload(); };
  const remove = useDelete(() => { setSelected(null); reload(); });
  const canEdit = !!dates.data?.actionsEnabled;
  const canRequest = canEdit && (role === "admin" || role === "sales_manager"); // a KAM does not raise gift requests
  const all = companyId === ALL_CLIENTS;
  // A new occasion needs one client: ask first when all are shown.
  const ask = useClientFirst({ active: !!form && !form.item, fixed: all ? null : companyId, onCancel: () => setForm(null) });

  const ranged = useMemo(() => (dates.data?.items ?? []).filter((i) => i.daysAway <= Number(range)), [dates.data, range]);
  const listed = useMemo(() => {
    const rows = tab === "ALL" ? [...ranged] : ranged.filter((i) => i.tab === tab);
    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
    if (sort === "priority") rows.sort((a, b) => RANK[a.priority ?? "NORMAL"] - RANK[b.priority ?? "NORMAL"] || a.date.localeCompare(b.date));
    return rows;
  }, [ranged, tab, sort]);
  const count = (key: string) => (key === "ALL" ? ranged.length : ranged.filter((i) => i.tab === key).length);

  // The month grid: every date of the month, with its planning details where Gifting OS sends them.
  const shown = useMemo(() => {
    const planned = new Map((dates.data?.items ?? []).map((i) => [i.key, i]));
    const own = new Map((occasions.data?.items ?? []).map((o) => [o.id, o]));
    const needle = q.toLowerCase();
    const inMonth = (grid.data?.calendar.items ?? []).filter((d) => d.date.startsWith(monthKey));
    const here = inMonth.map((d): OverviewItem => {
      const found = planned.get(d.key);
      if (found) return found;
      const basic = fromCalendarDay(d);
      const saved = basic.occasionId ? own.get(basic.occasionId) : undefined;
      return saved ? { ...basic, repeatAnnually: saved.repeatAnnually, sourceDate: saved.occasionDate, description: saved.description, priority: saved.priority, notes: saved.notes } : basic;
    }).filter((i) => !needle || `${i.name} ${i.label}`.toLowerCase().includes(needle));
    const around = (dates.data?.items ?? []).filter((i) => !i.date.startsWith(monthKey)); // the grid's neighbouring days
    return [...here, ...around];
  }, [dates.data, grid.data, occasions.data, monthKey, q]);

  const proceed = (item: OverviewItem) => setStarting({
    companyId: item.accountId ?? companyId, recipientId: item.recipientId ?? undefined, recipientName: item.recipientId ? item.name : undefined,
    source: item.eventId ? `event:${item.eventId}` : item.occasionId ? `occasion:${item.occasionId}` : undefined, deliveryDate: item.date,
  });
  const act = (item: OverviewItem, kind: ActionKind) => {
    if (kind === "plan" || kind === "create") {
      setSelected(null);
      if (item.requests?.length) setWarn(item); // warn before a second request for the same date
      else proceed(item);
    } else if (kind === "request" && item.requestId) router.push(`/gifting-requests/${item.requestId}`);
    else setSelected(item);
  };

  // A person's event or the client's own occasion can be changed; editing needs its saved details.
  const ownerId = selected?.accountId ?? (all ? null : companyId);
  const path = !selected || !canEdit || !ownerId ? null
    : selected.eventId ? `/os/${ownerId}/events/${selected.eventId}`
      : selected.occasionId && !selected.isGlobal ? `/os/${ownerId}/occasions/${selected.occasionId}` : null;
  const editable = !!path && selected?.repeatAnnually !== undefined;

  const months = Array.from({ length: 24 }, (_, i) => new Date(new Date().getFullYear(), new Date().getMonth() - 6 + i, 1));
  if (!months.some((m) => isoOf(m) === isoOf(month))) months.push(month);
  months.sort((a, b) => a.getTime() - b.getTime());
  const step = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  const error = (!dates.data && dates.error) || (view === "calendar" && !grid.data && grid.error);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="View" className="flex gap-1 rounded-xl border border-slate-300/80 bg-white p-1">
          {([["calendar", "Calendar", CalendarDays], ["list", "List", ListIcon]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => choose(key)} className={cn("pressable flex h-8 items-center gap-2 rounded-lg px-4 text-sm font-semibold", view === key ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100")}><Icon size={16} />{label}</button>
          ))}
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2.5">
          <SearchInput className="min-w-0 flex-1 sm:max-w-xs" value={search} onChange={setSearch} placeholder="Search recipient or occasion…" />
          {view === "calendar" ? (
            <select aria-label="Month" className={select} value={isoOf(month)} onChange={(e) => setMonth(new Date(`${e.target.value}T00:00:00`))}>
              {months.map((m) => <option key={isoOf(m)} value={isoOf(m)}>{m.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</option>)}
            </select>
          ) : (
            <select aria-label="Date range" className={select} value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((value) => <option key={value} value={value}>Next {value} days</option>)}
            </select>
          )}
          {canEdit && <Button onClick={() => setForm({ item: null })}><Plus className="h-4 w-4" />Add Occasion</Button>}
        </div>
      </div>

      {view === "calendar" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-sm text-slate-700">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-emerald-500" />Recipient</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-violet-400" />Company Event</span>
          </div>
          <div className="flex items-center gap-3 text-sm font-semibold text-slate-900">
            <button type="button" aria-label="Previous month" onClick={() => step(-1)} className={arrow}><ChevronLeft size={16} /></button>
            <span className="min-w-36 text-center">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
            <button type="button" aria-label="Next month" onClick={() => step(1)} className={arrow}><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
      {(dates.data?.pagination.total_records ?? dates.data?.pagination.totalRecords ?? 0) > FETCH && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Only the nearest {FETCH} dates carry planning details. Search or choose one client to narrow them.</p>
      )}

      {error ? <StateView kind="error" message={error} onRetry={reload} />
        : view === "calendar" ? (
          <MonthGrid month={month} items={shown} loading={(dates.loading && !dates.data) || grid.loading} onSelect={setSelected} onDateClick={canEdit ? (date) => setForm({ item: null, date }) : undefined} />
        ) : !dates.data ? <TableSkeleton columns={6} /> : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white p-1.5">
              <div role="tablist" aria-label="Status" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {TABS.map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("pressable flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium", tab === key ? "bg-brand-soft font-semibold text-brand" : "text-slate-600 hover:bg-slate-50")}>
                    {label}<span className={cn("rounded-full px-1.5 text-[11px] font-semibold", tab === key ? "bg-white" : "bg-slate-100")}>{count(key)}</span>
                  </button>
                ))}
              </div>
              <select aria-label="Sort by" className={cn(select, "h-9")} value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>

            {!listed.length ? <StateView kind="empty" title={q || tab !== "ALL" ? "Nothing matches" : "No occasions in this range"} message={q || tab !== "ALL" ? "Try another search or status." : "Add an occasion, or choose a longer range."} /> : (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
                  <Table className="min-w-[58rem]">
                    <TableHeader className="bg-slate-50/80"><TableRow><TableHead className="pl-4">Recipient / Event</TableHead><TableHead>Occasion</TableHead><TableHead>Date &amp; Countdown</TableHead><TableHead>Status</TableHead><TableHead>Budget</TableHead><TableHead className="pr-4">Action</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {listed.map((item) => {
                        const action = actionFor(item, canRequest);
                        const { icon: Icon, tint } = kindMeta(item.kind);
                        const under = [item.sourceType === "COMPANY" ? "Company Event" : item.relationship, item.accountName].filter(Boolean).join(" · ");
                        return (
                          <TableRow key={item.key} tabIndex={0} className="cursor-pointer" onClick={() => setSelected(item)} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setSelected(item); }}>
                            <TableCell className="pl-4"><div className="flex items-center gap-3"><Subject item={item} /><div className="min-w-0"><div className="max-w-[14rem] truncate font-semibold capitalize text-slate-900">{item.name}</div><div className="max-w-[14rem] truncate text-xs text-slate-500">{under}</div></div></div></TableCell>
                            <TableCell><span className="flex items-center gap-3 font-medium text-slate-900"><span aria-hidden="true" className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tint)}><Icon size={20} /></span>{item.label}</span></TableCell>
                            <TableCell><div className="font-semibold tabular-nums text-slate-900">{fullDay(item.date)}</div><div className={cn("text-xs", item.daysAway <= 7 ? "font-medium text-amber-700" : "text-slate-500")}>{countdownText(item.daysAway)}</div></TableCell>
                            <TableCell><StatusPill status={item.status} /></TableCell>
                            <TableCell className="font-semibold tabular-nums text-slate-900">{item.budget ? `₹${item.budget.toLocaleString("en-IN")}` : "—"}</TableCell>
                            <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1.5">
                                <button type="button" onClick={() => act(item, action.kind)} className={cn("pressable inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold", action.kind === "plan" ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-brand/60 bg-white text-brand hover:bg-brand-soft")}>{action.label}<ArrowRight size={15} aria-hidden /></button>
                                <button type="button" aria-label={`More for ${item.name}`} onClick={() => setSelected(item)} className="pressable rounded-lg p-2 text-slate-500 hover:bg-slate-100"><MoreVertical size={16} /></button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
            )}
          </>
        )}

      {selected && (
        <OccasionDetails key={selected.key} item={selected} canRequest={canRequest} onClose={() => setSelected(null)} onAct={act}
          onEdit={editable ? () => { setForm({ item: { ...selected, accountId: ownerId! } }); setSelected(null); } : undefined}
          onDelete={path ? () => { remove.ask({ path, title: `Delete ${selected.sourceType === "COMPANY" ? selected.name : `${selected.name}'s ${selected.label}`}?`, done: "Occasion deleted", message: "It is removed from Gifting OS too." }); setSelected(null); } : undefined} />
      )}
      {ask.dialog}
      {form && (form.item || ask.ready) && <OccasionForm companyId={form.item ? companyId : ask.clientId!} editing={form.item} date={form.date} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {starting && canRequest && <RequestWizard start={starting} onClose={() => { setStarting(null); reload(); }} onCreated={(id) => { setStarting(null); router.push(`/gifting-requests/${id}`); }} />}

      <Sheet open={!!warn} title="A request already exists" subtitle={warn ? `${warn.name} · ${warn.label} · ${fullDay(warn.date)}` : undefined} onClose={() => setWarn(null)}>
        {warn && (
          <div className="space-y-4">
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {warn.requests?.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="font-semibold text-slate-900">{r.requestCode ?? "Request"}</span><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", metaOf(r.status).chip)}>{metaOf(r.status).label}</span></li>)}
            </ul>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => { const item = warn; setWarn(null); proceed(item); }}>Create anyway</Button>
              <Button onClick={() => { router.push(`/gifting-requests/${warn.requestId ?? warn.requests![0].id}`); setWarn(null); }}>Open existing request</Button>
            </div>
          </div>
        )}
      </Sheet>
      {remove.dialog}
    </>
  );
}
