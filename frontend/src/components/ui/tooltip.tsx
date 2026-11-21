import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A small dark label above an icon button, on hover or keyboard focus. Pure CSS, so it costs nothing per row.
 * The wrapper catches the hover too, so a disabled button still explains itself ("No phone number").
 */
export function Tooltip({ label, children, className, side = "top" }: { label: string; children: ReactNode; className?: string; side?: "top" | "bottom" }) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn("pointer-events-none absolute left-1/2 z-30 -translate-x-1/2", side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5", " whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100")}
      >
        {label}
      </span>
    </span>
  );
}
