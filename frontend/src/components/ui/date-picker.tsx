"use client";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { daysInMonth, longDate, MONTHS, mondayIndex, parseYmd, toIso } from "@/lib/date-parts";
import { todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";
import { RequiredMark } from "./required-mark";

type Props = {
  label?: string;
  value: string; // YYYY-MM-DD or ""
  onChange: (iso: string) => void;
  min?: string;
  max?: string; // the last date that can be picked (for example today, for a report range)
  error?: string;
  required?: boolean;
  compact?: boolean; // a small button (used next to the quick picks) instead of a full-width field
  placeholder?: string;
  size?: "md" | "sm"; // sm: a 40px field that fits a filter row
  ariaLabel?: string; // the field's name when there is no visible label
};

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** A calendar that opens under the field. Replaces the browser's own date control. */
export function DatePicker({ label, value, onChange, min, max, error, required, compact, placeholder = "Select date", size = "md", ariaLabel }: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = parseYmd(value);
  const today = parseYmd(todayIso())!;
  const [view, setView] = useState(() => ({ y: (selected ?? today).y, m: (selected ?? today).m }));
  const minYmd = parseYmd(min);
  const maxYmd = parseYmd(max);

  const shift = (delta: number) =>
    setView(({ y, m }) => {
      const n = y * 12 + (m - 1) + delta;
      return { y: Math.floor(n / 12), m: (n % 12) + 1 };
    });
  const disabled = (d: number) => {
    const iso = toIso({ ...view, d });
    return (!!minYmd && iso < toIso(minYmd)) || (!!maxYmd && iso > toIso(maxYmd));
  };
  // no paging into months where nothing can be picked
  const canBack = !minYmd || view.y * 12 + view.m > minYmd.y * 12 + minYmd.m;
  const canNext = !maxYmd || view.y * 12 + view.m < maxYmd.y * 12 + maxYmd.m;
  const pick = (iso: string) => { onChange(iso); setOpen(false); };

  const lead = mondayIndex(view.y, view.m);
  const cells = Array.from({ length: lead + daysInMonth(view.y, view.m) }, (_, i) => (i < lead ? 0 : i - lead + 1));

  const button = (
    <button
      ref={anchor}
      type="button"
      onClick={() => { if (!open && selected) setView({ y: selected.y, m: selected.m }); setOpen((o) => !o); }}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-invalid={!!error || undefined}
      aria-label={ariaLabel ? `${ariaLabel}: ${value ? longDate(value) : "not set"}` : undefined}
      className={cn(
        "pressable inline-flex items-center gap-2 border bg-white text-left outline-none transition-shadow focus-visible:ring-4 focus-visible:ring-brand/15",
        compact ? "h-8 rounded-full px-3 text-xs font-medium" : size === "sm" ? "h-10 rounded-xl px-3 text-sm" : "h-11 w-full rounded-xl px-3.5 text-base sm:text-sm",
        error ? "border-red-400 ring-4 ring-red-100" : open ? "border-brand ring-4 ring-brand/15" : "border-slate-300/80 hover:border-slate-400",
        compact && value && "border-brand bg-brand-soft text-brand",
      )}
    >
      <CalendarDays className={cn("shrink-0 text-slate-400", compact ? "h-3.5 w-3.5" : "h-4 w-4", compact && value && "text-brand")} />
      <span className={cn("truncate", !value && "text-slate-400")}>{value ? longDate(value) : compact ? "Pick a date" : placeholder}</span>
    </button>
  );

  return (
    <div className={cn(!compact && "space-y-1")}>
      {label && (
        <span className="block text-sm font-medium text-slate-700">
          {label}
          {required && <RequiredMark />}
        </span>
      )}
      {button}
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}

      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={296} label="Choose a date">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => shift(-1)} disabled={!canBack} aria-label="Previous month" className="pressable rounded-full p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
          <div className="text-sm font-semibold tracking-tight">{MONTHS[view.m - 1]} {view.y}</div>
          <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month" className="pressable rounded-full p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-slate-400">
          {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const iso = toIso({ ...view, d });
            const isSel = iso === value;
            const isToday = iso === toIso(today);
            const off = disabled(d);
            return (
              <button
                key={i}
                type="button"
                disabled={off}
                onClick={() => pick(iso)}
                aria-label={longDate(iso)}
                aria-pressed={isSel}
                className={cn(
                  "pressable mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm",
                  isSel ? "bg-brand font-semibold text-white shadow-sm" : "text-slate-700 hover:bg-brand-soft",
                  isToday && !isSel && "font-semibold text-brand ring-1 ring-brand/40",
                  off && "cursor-not-allowed text-slate-300 hover:bg-transparent",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
          <button type="button" onClick={() => { const t = toIso(today); if ((!min || t >= min) && (!max || t <= max)) pick(t); }} className="font-medium text-brand hover:underline">Today</button>
          {value && !required && <button type="button" onClick={() => pick("")} className="text-slate-500 hover:underline">Clear</button>}
        </div>
      </Popover>
    </div>
  );
}
