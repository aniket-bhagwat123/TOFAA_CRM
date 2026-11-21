"use client";
import { createPortal } from "react-dom";
import { animate } from "motion";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DialogHeader, type Tone } from "./dialog-header";

const WIDTH = { md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl" };
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode; width?: keyof typeof WIDTH; subtitle?: string; icon?: LucideIcon; tone?: Tone };

/** A dialog in the middle of the screen. It grows out of the centre and settles with a spring; reduced motion just fades. */
export function Modal({ open, title, subtitle, icon, tone, onClose, children, width = "lg" }: Props) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) setMounted(true); }, [open]);

  useLayoutEffect(() => {
    if (!mounted || !panel.current || !scrim.current) return;
    const spring = { type: "spring", bounce: 0, duration: 0.38 } as const;
    const from = open ? 0 : 1;
    const to = open ? 1 : 0;
    const a = reduced()
      ? animate(panel.current, { opacity: [from, to] }, { duration: 0.15 })
      : animate(panel.current, { opacity: [from, to], scale: open ? [0.95, 1] : [1, 0.97], y: open ? [12, 0] : [0, 8] }, spring);
    animate(scrim.current, { opacity: [from, to] }, { duration: 0.2 });
    a.finished.then(() => !open && setMounted(false));
    return () => a.stop();
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;
  // Rendered into <body>: a transformed or animated ancestor would otherwise trap "fixed" inside itself and the
  // scrim would stop short of the window edges.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="presentation">
      <div ref={scrim} className="absolute inset-0 bg-slate-900/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("relative flex max-h-full w-full flex-col overflow-hidden rounded-3xl bg-white shadow-float", WIDTH[width])}
        style={{ opacity: 0 }}
      >
        <DialogHeader title={title} subtitle={subtitle} icon={icon} tone={tone} onClose={onClose} className="border-b border-slate-100 px-6" />
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,

  );
}
