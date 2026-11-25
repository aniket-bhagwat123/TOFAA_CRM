"use client";
/**
 * A filter button with an icon ("♡ Relationship ⌄") that opens a short list, optionally with a search box.
 * Shows the chosen value in place of the label, and turns blue while it is filtering. The first option ("" value)
 * is the unfiltered choice.
 */
import { Check, ChevronDown, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string; hint?: string };

export function FilterMenu({ icon, label, value, options, onChange, searchable, width = 260, className }: {
  icon: ReactNode; label: string; value: string; options: FilterOption[]; onChange: (value: string) => void;
  searchable?: boolean; width?: number; className?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const selected = options.find((o) => o.value === value);
  const shown = options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(term.trim().toLowerCase()));
  const close = () => { setOpen(false); setTerm(""); };

  return (
    <>
      <button ref={anchor} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          "pressable flex h-10 w-full shrink-0 items-center gap-2 rounded-xl border bg-white px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/25 sm:w-auto",
          value ? "border-brand bg-brand-soft text-brand" : open ? "border-brand text-slate-800" : "border-slate-300/80 text-slate-800 hover:bg-slate-50",
          className,
        )}>
        <span className={value ? "text-brand" : "text-slate-500"} aria-hidden="true">{icon}</span>
        <span className="max-w-[10rem] flex-1 truncate text-left font-medium">{selected?.label ?? label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", value ? "text-brand" : "text-slate-400", open && "rotate-180")} aria-hidden="true" />
      </button>
      <Popover anchor={anchor} open={open} onClose={close} width={width} label={label}>
        {searchable && (
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search" aria-label={`Search ${label}`}
              className="h-9 w-full rounded-lg border border-slate-300/80 pl-9 pr-3 text-sm outline-none focus:border-brand" />
          </div>
        )}
        <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
          {shown.map((o) => (
            <button key={o.value || "__all"} type="button" role="option" aria-selected={o.value === value} onClick={() => { onChange(o.value); close(); }}
              className={cn("flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50", o.value === value && "bg-brand-soft font-medium text-brand")}>
              <span className="min-w-0">
                <span className="block truncate">{o.label}</span>
                {o.hint && <span className="block truncate text-xs text-slate-500">{o.hint}</span>}
              </span>
              {o.value === value && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
            </button>
          ))}
          {!shown.length && <p className="p-3 text-sm text-slate-500">No matches.</p>}
        </div>
      </Popover>
    </>
  );
}
