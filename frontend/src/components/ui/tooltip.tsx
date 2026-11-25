import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A small dark label above an icon button, on hover or keyboard focus. Pure CSS, so it costs nothing per row.
 * The wrapper catches the hover too, so a disabled button still explains itself ("No phone number").
 */
/** `align="end"`: the label grows to the left from the trigger's right edge, for triggers at the right edge of a card or
 * scroll area (a centred label there would stick out and add a sideways scrollbar, even while hidden). */
export function Tooltip({ label, children, className, side = "top", align = "center" }: { label: string; children: ReactNode; className?: string; side?: "top" | "bottom"; align?: "center" | "end" }) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn("pointer-events-none absolute z-30", align === "end" ? "right-0" : "left-1/2 -translate-x-1/2", side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5", " whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100")}
      >
        {label}
      </span>
    </span>
  );
}
