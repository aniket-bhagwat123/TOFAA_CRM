"use client";
import { formatDate, nextBusinessDayIso, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DatePicker } from "../ui/date-picker";

type Props = { label: string; value: string; onChange: (iso: string) => void; error?: string; required?: boolean };

/** Quick picks (tomorrow, in 3 days, next week) plus a date field: a follow-up date in one tap. */
export function DateChips({ label, value, onChange, error, required }: Props) {
  const chips = [
    { text: "Tomorrow", iso: nextBusinessDayIso() },
    { text: "In 3 days", iso: todayIso(3) },
    { text: "Next week", iso: todayIso(7) },
  ];
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span>}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.text}
            type="button"
            onClick={() => onChange(c.iso)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              value === c.iso ? "border-brand bg-brand-soft text-brand" : "border-slate-300 text-slate-600 hover:bg-slate-50",
            )}
            title={formatDate(c.iso)}
          >
            {c.text}
          </button>
        ))}
        <DatePicker compact value={chips.some((c) => c.iso === value) ? "" : value} onChange={onChange} min={todayIso()} required />
      </div>
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}
    </div>
  );
}
