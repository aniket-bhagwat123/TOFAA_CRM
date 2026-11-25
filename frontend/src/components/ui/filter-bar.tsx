"use client";
/**
 * The compact filter row used above lists and boards (Leads, Follow-ups): a small "Filter" label, rounded dropdowns
 * that read "All …" when unused and turn blue while filtering, on/off pills, and Clear. One look everywhere.
 */
import { SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FilterLabel() {
  return (
    <span className="hidden items-center gap-1.5 text-sm font-medium text-slate-500 sm:flex">
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filter
    </span>
  );
}

/** A dropdown filter: "All …" when unused; blue while it is filtering, so applied filters are easy to spot. */
export function FilterSelect({ label, value, onChange, all, options, className }: {
  label: string; value: string; onChange: (v: string) => void; all: string; options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 w-[calc(50%-0.25rem)] cursor-pointer truncate rounded-full border pl-3.5 pr-8 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand/25 sm:w-auto",
        value ? "border-brand bg-brand-soft text-brand" : "border-slate-300/80 bg-white text-slate-700 hover:border-slate-400",
        className,
      )}
    >
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** An on/off filter pill (e.g. Overdue). tone="red" for a filter about something going wrong. */
export function FilterToggle({ on, onChange, children, tone = "brand" }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; tone?: "brand" | "red" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        "pressable h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium",
        on ? (tone === "red" ? "border-red-300 bg-red-50 text-red-700" : "border-brand bg-brand-soft text-brand") : "border-slate-300/80 bg-white text-slate-700 hover:border-slate-400",
      )}
    >
      {children}
    </button>
  );
}

/** Clears every filter; shown only while something is filtering, with how many. */
export function ClearFilters({ count, onClear }: { count: number; onClear: () => void }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClear} className="pressable flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
      <X className="h-3.5 w-3.5" aria-hidden="true" />Clear{count > 1 ? ` (${count})` : ""}
    </button>
  );
}
