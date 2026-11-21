"use client";
import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildTime, longTime, parseTime } from "@/lib/date-parts";
import { cn } from "@/lib/utils";
import { Popover } from "./popover";
import { RequiredMark } from "./required-mark";

type Props = { label?: string; value: string; onChange: (hhmm: string) => void; error?: string; required?: boolean; placeholder?: string };

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const PRESETS = ["09:00", "11:00", "14:00", "16:00"];

/** Hour, minute and AM/PM columns that open under the field. Replaces the browser's own time control. */
export function TimePicker({ label, value, onChange, error, required, placeholder = "Select time" }: Props) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const t = parseTime(value) ?? { h12: 11, min: 0, pm: false };
  const hourRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) hourRef.current?.scrollIntoView({ block: "center" }); }, [open]);

  const set = (patch: Partial<typeof t>) => {
    const n = { ...t, ...patch };
    onChange(buildTime(n.h12, n.min, n.pm));
  };
  const col = "flex max-h-48 flex-1 flex-col gap-0.5 overflow-y-auto";
  const cell = (on: boolean) =>
    cn("pressable rounded-lg px-2 py-1.5 text-center text-sm", on ? "bg-brand font-semibold text-white" : "text-slate-700 hover:bg-brand-soft");

  return (
    <div className="space-y-1">
      {label && (
        <span className="block text-sm font-medium text-slate-700">
          {label}
          {required && <RequiredMark />}
        </span>
      )}
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={!!error || undefined}
        className={cn(
          "pressable inline-flex h-11 w-full items-center gap-2 rounded-xl border bg-white px-3.5 text-left text-base outline-none transition-shadow focus-visible:ring-4 focus-visible:ring-brand/15 sm:text-sm",
          error ? "border-red-400 ring-4 ring-red-100" : open ? "border-brand ring-4 ring-brand/15" : "border-slate-300/80 hover:border-slate-400",
        )}
      >
        <Clock className="h-4 w-4 shrink-0 text-slate-400" />
        <span className={cn(!value && "text-slate-400")}>{value ? longTime(value) : placeholder}</span>
      </button>
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}

      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={268} label="Choose a time">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => { onChange(p); setOpen(false); }} className={cn("pressable rounded-full border px-2.5 py-1 text-xs font-medium", value === p ? "border-brand bg-brand-soft text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
              {longTime(p)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className={col} role="listbox" aria-label="Hour">
            {HOURS.map((h) => (
              <button key={h} ref={h === t.h12 ? hourRef : undefined} type="button" onClick={() => set({ h12: h })} className={cell(!!value && h === t.h12)}>{h}</button>
            ))}
          </div>
          <div className={col} role="listbox" aria-label="Minute">
            {MINUTES.map((m) => (
              <button key={m} type="button" onClick={() => set({ min: m })} className={cell(!!value && m === t.min)}>{String(m).padStart(2, "0")}</button>
            ))}
          </div>
          <div className="flex flex-col gap-0.5" role="listbox" aria-label="AM or PM">
            {(["AM", "PM"] as const).map((x) => (
              <button key={x} type="button" onClick={() => set({ pm: x === "PM" })} className={cell(!!value && t.pm === (x === "PM"))}>{x}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-2">
          <button type="button" onClick={() => { if (!value) set({}); setOpen(false); }} className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white">Done</button>
        </div>
      </Popover>
    </div>
  );
}
