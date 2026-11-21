"use client";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" };

type Props = { open: boolean; title: string; width?: keyof typeof widths; onClose: () => void; children: ReactNode };

export function FormPanel({ open, title, width = "md", onClose, children }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className={cn("h-full w-full overflow-y-auto bg-white p-6 shadow-xl", widths[width])} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
