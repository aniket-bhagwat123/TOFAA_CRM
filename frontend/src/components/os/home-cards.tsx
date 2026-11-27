"use client";
/**
 * The cards of the OS Home screen: the layout and sizes of Gifting OS (its components/dashboard) in the CRM's own
 * colours. Sizes are in px, as Gifting OS sets them.
 */
import { Activity, ArrowRight, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, FileText, Gem, Gift, Info, Star, Truck, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useApi } from "@/hooks/use-api";
import { todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalendarDay, OsHome, PersonCard } from "@/types/os-modules";

const CARD = "overflow-hidden rounded-[10px] border border-slate-200 bg-white";
const TITLE = "text-[13px] font-semibold text-slate-900";
const MUTED = "text-[12px] leading-4 text-slate-500";
const Loading = ({ rows = 2, className = "p-4" }: { rows?: number; className?: string }) => (
  <div className={cn("space-y-3", className)}>{Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
);
const ROUND = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full";
const ViewAll = ({ href }: { href: string }) => (
  <Link href={href} aria-label="View all" title="View all" className="inline-flex h-8 w-8 items-center justify-center rounded-full text-brand hover:bg-white/80"><ArrowRight size={16} /></Link>
);
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

// --- banner strip -------------------------------------------------------------------------------------------------

type Banner = { id: string; title?: string | null; imageUrl: string };

/** The banner strip: 2156 × 198 pictures managed on the Banners page, those of the client being viewed. */
export function BannerStrip({ companyId }: { companyId?: string }) {
  const banners = useApi<Banner[]>("/banners", { companyId });
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const shown = (banners.data ?? []).filter((b) => b.imageUrl && !broken.has(b.id));
  const count = shown.length;
  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = window.setInterval(() => setIndex((v) => (v + 1) % count), 8000);
    return () => window.clearInterval(timer);
  }, [count, paused]);
  if (!count) return null;
  const banner = shown[index % count];
  const go = (step: number) => setIndex((v) => (v + step + count) % count);
  const arrow = "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-slate-900 shadow hover:bg-white";
  return (
    <section aria-label="Announcements" aria-roledescription="carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} className="relative overflow-hidden rounded-[10px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link */}
      <img key={banner.id} src={banner.imageUrl} alt={banner.title ?? ""} width={2156} height={198} className="block h-auto w-full" onError={() => setBroken((c) => new Set(c).add(banner.id))} />
      {count > 1 && (
        <>
          <button type="button" aria-label="Previous banner" onClick={() => go(-1)} className={cn(arrow, "left-2")}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next banner" onClick={() => go(1)} className={cn(arrow, "right-2")}><ChevronRight size={16} /></button>
          <span className="absolute bottom-1.5 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] tabular-nums text-white" aria-live="polite">{(index % count) + 1} / {count}</span>
        </>
      )}
    </section>
  );
}

// --- occasion calendar ---------------------------------------------------------------------------------------------

const FILTERS = [["ALL", "All"], ["EXTERNAL", "External"], ["INTERNAL", "Internal"], ["COMPANY", "Company Events"]] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthKey = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}`;
const shiftMonth = (key: string, step: number) => { const [y, m] = key.split("-").map(Number); const d = new Date(y, m - 1 + step, 1); return monthKey(d.getFullYear(), d.getMonth()); };
const monthLabel = (key: string) => new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

function chipStyle(item: CalendarDay) {
  if (item.kind === "BIRTHDAY") return { tone: "bg-brand-100/80 text-brand-900", Icon: Gift };
  if (item.kind === "ANNIVERSARY" || item.kind === "WORK_ANNIVERSARY") return { tone: "bg-amber-100/80 text-amber-900", Icon: Gem };
  if (item.category === "COMPANY") return { tone: "bg-indigo-100/70 text-indigo-900", Icon: CalendarDays };
  return { tone: "bg-violet-100/70 text-violet-900", Icon: Star };
}

function Chip({ item }: { item: CalendarDay }) {
  const { tone, Icon } = chipStyle(item);
  const person = item.category !== "COMPANY" && !!item.recipientId;
  return (
    <Link href="/os/calendar" title={`${item.title} · ${item.label}`} className={cn("flex min-h-6 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] leading-tight hover:brightness-95", tone)}>
      <Icon size={13} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate font-medium">{person ? `${item.title} ${item.label}` : item.title}</span>
    </Link>
  );
}

type CalendarProps = { items: CalendarDay[]; month: string; filter: string; loading: boolean; failed: boolean; onMonth: (m: string) => void; onFilter: (f: string) => void };

export function OccasionCalendar({ items, month, filter, loading, failed, onMonth, onFilter }: CalendarProps) {
  const today = todayIso();
  const thisMonth = today.slice(0, 7);
  const [year, monthIndex] = [Number(month.slice(0, 4)), Number(month.slice(5)) - 1];
  const lead = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => (i < lead || i >= lead + days ? null : i - lead + 1));
  const byDay = new Map<number, CalendarDay[]>();
  // Only this month's dates: while another month loads, the one on screen must not borrow the last one's.
  for (const item of items.filter((x) => x.date.startsWith(month))) { const d = Number(item.date.slice(8, 10)); byDay.set(d, [...(byDay.get(d) ?? []), item]); }
  const options = Array.from({ length: 19 }, (_, i) => shiftMonth(thisMonth, i - 6));
  if (!options.includes(month)) options.push(month);
  const step = "flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-brand shadow-sm hover:bg-slate-50";

  return (
    <section aria-label="Occasion calendar" className={CARD}>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-2">
        <h2 className="flex items-center gap-3 text-[14px] font-semibold text-slate-900"><span aria-hidden="true" className={cn(ROUND, "bg-brand-soft text-brand")}><CalendarDays size={18} /></span>Occasion Calendar</h2>
        <div role="tablist" aria-label="Calendar filter" className="flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={filter === id} onClick={() => onFilter(id)}
              className={cn("min-h-7 rounded-full px-3.5 text-[12px] font-medium transition", filter === id ? "bg-brand text-white" : "text-slate-900 hover:bg-slate-50")}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))} className={step}><ChevronLeft size={16} /></button>
          <label className="relative">
            <span className="sr-only">Month</span>
            <select value={month} onChange={(e) => onMonth(e.target.value)} className="h-8 min-w-[10.5rem] appearance-none rounded-full border border-slate-200 bg-white pl-4 pr-9 text-[13px] font-medium text-slate-900 shadow-sm outline-none focus:border-brand">
              {options.map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          </label>
          <button type="button" aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))} className={step}><ChevronRight size={16} /></button>
        </div>
      </header>
      {failed && <p role="alert" className="mx-4 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">We couldn&apos;t load the calendar. Try another month or refresh.</p>}
      <div className="overflow-x-auto px-3 pb-2">
        <div className={cn("min-w-[44rem] overflow-hidden rounded-lg border border-slate-200/70", loading && "opacity-60 transition-opacity")} aria-busy={loading}>
          <div className="grid grid-cols-7 bg-slate-50/70 text-center text-[12px] text-slate-500">{WEEKDAYS.map((d) => <div key={d} className="border-r border-slate-200/60 py-1 last:border-r-0">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {cells.map((day, index) => {
              const list = day ? byDay.get(day) ?? [] : [];
              const iso = day ? `${month}-${String(day).padStart(2, "0")}` : "";
              return (
                <div key={index} className="h-[3.6rem] min-w-0 overflow-hidden border-b border-r border-slate-200/60 p-1 [&:nth-child(7n)]:border-r-0">
                  {day && (
                    <>
                      <div className="mb-0.5 flex items-center justify-between gap-1">
                        <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[12px] tabular-nums text-slate-900", iso === today && "bg-brand font-semibold !text-white")}>{day}</span>
                        {list.length > 1 && <Link href="/os/calendar" className="rounded px-1 text-[11px] font-semibold text-brand hover:underline">+{list.length - 1} more</Link>}
                      </div>
                      {list[0] && <Chip item={list[0]} />}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// --- people, actions, activity --------------------------------------------------------------------------------------

const daysChip = (days: number) => (days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`);

export function ImportantPeopleCard({ title, icon, people, loading, empty }: { title: string; icon: ReactNode; people: PersonCard[]; loading: boolean; empty: string }) {
  return (
    <section aria-label={title} className={CARD}>
      <header className="flex items-center justify-between gap-3 bg-gradient-to-r from-brand-soft to-brand-soft/30 px-4 py-2">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={cn(ROUND, "bg-white/80 text-amber-500 shadow-sm")}>{icon}</span>
          <h2 className={TITLE}>{title}</h2>
        </div>
        <ViewAll href="/people" />
      </header>
      {loading ? <Loading /> : !people.length ? <p className={cn(MUTED, "px-4 py-8 text-center")}>{empty}</p> : (
        <ul className="divide-y divide-slate-200/70">
          {people.slice(0, 2).map((p) => (
            <li key={`${p.recipientId}-${p.kind ?? p.label}`}>
              <Link href="/people" className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50">
                <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold capitalize text-slate-900">{p.name}</p><p className={cn(MUTED, "truncate")}>{p.label} · {dayLabel(p.date)}{p.accountName ? ` · ${p.accountName}` : ""}</p></div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-amber-900">{daysChip(p.daysAway)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ActionRequiredCard({ items, total, loading }: { items: OsHome["summary"]["actionRequired"]["items"]; total: number; loading: boolean }) {
  return (
    <section aria-label="Action required" className={CARD}>
      <header className="flex items-center justify-between gap-3 bg-gradient-to-r from-rose-50 to-rose-50/30 px-4 py-2">
        <h2 className={cn(TITLE, "flex items-center gap-3")}><span aria-hidden="true" className={cn(ROUND, "bg-white/80 text-rose-500 shadow-sm")}><Zap size={18} /></span>Action Required</h2>
        {total > 0 && <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-medium text-rose-700">{total} {total === 1 ? "item" : "items"}</span>}
      </header>
      {loading ? <Loading /> : !items.length ? <p className={cn(MUTED, "px-4 py-8 text-center")}>You&apos;re all caught up. Nothing needs your attention.</p> : (
        <ul className="divide-y divide-slate-200/70">
          {items.slice(0, 2).map((item) => {
            const proposal = item.kind === "PROPOSAL_REVIEW";
            const href = proposal && item.requestId ? `/gifting-requests?open=${item.requestId}` : item.recipientId ? "/people" : "/gifting-requests";
            return (
              <li key={item.key}>
                <Link href={href} className="flex items-center gap-3 px-4 py-1.5 hover:bg-slate-50">
                  <span aria-hidden="true" className={cn(ROUND, proposal ? "bg-orange-50 text-orange-500" : "bg-sky-50 text-sky-600")}>{proposal ? <FileText size={18} /> : <Info size={18} />}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-slate-900">{item.title}</p><p className={cn(MUTED, "truncate")}>{item.description}</p></div>
                  <ChevronRight size={16} className="shrink-0 text-slate-500" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type ActivityRow = { key: string; title: string; at: string; kind: "done" | "shipping" | "update" };
const ICONS = { done: <CheckCircle2 size={20} className="text-emerald-600" />, shipping: <Truck size={20} className="text-slate-900" />, update: <Activity size={20} className="text-brand" /> };
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function RecentActivityCard({ rows, loading }: { rows: ActivityRow[]; loading: boolean }) {
  return (
    <section aria-label="Recent activity" className={CARD}>
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <h2 className={cn(TITLE, "flex items-center gap-2.5")}><Activity size={18} className="text-brand" />Recent Activity</h2>
        <ViewAll href="/os/activity" />
      </header>
      {loading ? <Loading rows={3} className="px-4 pb-4" /> : !rows.length ? <p className={cn(MUTED, "px-4 pb-6 pt-2 text-center")}>When something changes, it shows up here.</p> : (
        <ul className="px-4 pb-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-4 py-1.5">
              <span aria-hidden="true" className="flex w-6 shrink-0 justify-center">{ICONS[row.kind]}</span>
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{row.title}</p>
              <time dateTime={row.at} className={cn(MUTED, "shrink-0 tabular-nums")}>{dayTime(row.at)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
