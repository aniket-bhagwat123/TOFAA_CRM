"use client";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { OverviewItem } from "@/types/os-modules";
import { isoOf, kindMeta, parseIso } from "./meta";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHOWN = 2;

function Chip({ item, onSelect }: { item: OverviewItem; onSelect: (item: OverviewItem) => void }) {
  const company = item.sourceType === "COMPANY";
  const { icon: Icon } = kindMeta(item.kind);
  const when = parseIso(item.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(item); }} title={[item.name, item.label, item.accountName].filter(Boolean).join(" · ")}
      className={cn("pressable flex w-full items-center gap-1.5 rounded-xl px-1.5 py-1 text-left", company ? "bg-violet-100 text-violet-950 hover:bg-violet-200" : "bg-emerald-100 text-emerald-950 hover:bg-emerald-200")}>
      {company ? <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-200 text-violet-700"><Icon size={14} /></span>
        : <Avatar name={item.name} src={item.recipientAvatarUrl} size="xs" className="h-6 w-6 text-[0.6rem]" />}
      <span className="min-w-0"><span className="block truncate text-xs font-semibold capitalize leading-tight">{item.name}</span><span className="block truncate text-[0.65rem] leading-tight opacity-75">{item.label} • {when}</span></span>
    </button>
  );
}

/** A month grid (Sunday first) like a calendar app: each day lists what falls on it; tap one to open it. */
export function MonthGrid({ month, items, loading, onSelect, onDateClick }: { month: Date; items: OverviewItem[]; loading: boolean; onSelect: (item: OverviewItem) => void; onDateClick?: (iso: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const todayIso = isoOf(new Date());
  const byDay = useMemo(() => {
    const map = new Map<string, OverviewItem[]>();
    for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item]);
    return map;
  }, [items]);
  const start = new Date(month.getFullYear(), month.getMonth(), 1 - new Date(month.getFullYear(), month.getMonth(), 1).getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const weeks = days[35].getMonth() === month.getMonth() ? 6 : 5; // drop a trailing week that is entirely next month

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <div className="overflow-x-auto">
        <div className="min-w-[44rem]" role="grid" aria-label={month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} aria-busy={loading}>
          <div role="row" className="grid grid-cols-7 bg-brand-soft text-center text-sm font-semibold text-slate-700">{WEEKDAYS.map((name) => <div key={name} role="columnheader" className="py-3">{name}</div>)}</div>
          <div className="grid grid-cols-7">
            {days.slice(0, weeks * 7).map((date, index) => {
              const iso = isoOf(date);
              const here = byDay.get(iso) ?? [];
              const outside = date.getMonth() !== month.getMonth();
              const isPast = iso < todayIso;
              const open = expanded === iso;
              const clickable = onDateClick && !outside && !isPast;
              return (
                <div key={iso} role="gridcell" className={cn("min-h-28 min-w-0 border-b border-r border-slate-200/60 p-1.5", outside && "bg-slate-50/60", isPast && "opacity-60", clickable && "cursor-pointer hover:bg-brand-soft/40")} onClick={clickable ? () => onDateClick(iso) : undefined}>
                  <p className={cn("mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm", iso === todayIso ? "bg-brand font-semibold text-white" : outside ? "text-slate-300" : "text-slate-900")}>{date.getDate()}</p>
                  {loading ? (index % 3 === 0 && <Skeleton className="h-8 w-full rounded-xl" />) : (
                    <div className="space-y-1">
                      {(open ? here : here.slice(0, SHOWN)).map((item) => <Chip key={item.key} item={item} onSelect={onSelect} />)}
                      {here.length > SHOWN && <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : iso); }} className="w-full rounded-lg px-1.5 py-0.5 text-left text-xs font-semibold text-brand hover:bg-brand-soft">{open ? "Show less" : `+${here.length - SHOWN} more`}</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
