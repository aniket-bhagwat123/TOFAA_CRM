"use client";
import { Columns3, List, Table2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

export type ViewOption<T extends string> = { value: T; label: string; icon: LucideIcon };

/**
 * The Board / Table (or Board / List) switch, one look on every screen (Leads, Projects, Orders, Follow-ups):
 * icon-only buttons, the chosen one on the brand-soft tint, each named by a tooltip ("Board view", "Table view")
 * and by its accessible label. `value` null means none is chosen (a different list is open, as in Follow-ups).
 */
export function ViewToggle<T extends string>({ value, onChange, options, className }: {
  value: T | null; onChange: (v: T) => void; options: ViewOption<T>[]; className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Layout" className={cn("flex h-10 shrink-0 items-center rounded-xl border border-slate-300/80 bg-white p-1", className)}>
      {options.map(({ value: v, label, icon: Icon }) => (
        // icon-only buttons: the tooltip names each view (on hover and on keyboard focus); below, so the top bar never covers it
        <Tooltip key={v} label={`${label} view`} side="bottom">
          <button
            type="button" role="radio" aria-checked={value === v} aria-label={`${label} view`} onClick={() => onChange(v)}
            className={cn("pressable flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium sm:px-2",
              // selected: the brand-soft tint (#EEF6FB) with brand-navy icon and text
              value === v ? "bg-brand-soft text-brand" : "text-slate-600 hover:bg-slate-100")}
          >
            <Icon className="h-4 w-4 shrink-0" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/** The usual pairs. */
export const BOARD_TABLE: ViewOption<"board" | "table">[] = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "table", label: "Table", icon: Table2 },
];
export const BOARD_LIST: ViewOption<"board" | "list">[] = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "list", label: "List", icon: List },
];
