"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A panel that slides over the right side of the screen, as Gifting OS opens an occasion. */
export function SidePanel({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="animate-rise flex h-full w-full max-w-md flex-col bg-white shadow-sheet" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}
