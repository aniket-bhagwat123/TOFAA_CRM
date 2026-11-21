"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = { anchor: RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string };

/**
 * A floating panel that opens under its trigger. It lives in `document.body`, so a scrolling dialog never clips it,
 * it flips above the trigger when there is no room below, and it follows the trigger if the page scrolls.
 */
export function Popover({ anchor, open, onClose, children, width = 300, label }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const h = p.offsetHeight;
    const below = window.innerHeight - a.bottom;
    const flip = below < h + 12 && a.top > below;
    const left = Math.min(Math.max(8, a.left), window.innerWidth - Math.max(width, a.width) - 8);
    setPos({ top: flip ? a.top - h - 8 : a.bottom + 8, left, origin: flip ? "bottom left" : "top left" });
  }, [anchor, width]);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, onClose, place, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, transformOrigin: pos?.origin, visibility: pos ? "visible" : "hidden" }}
      className="animate-pop z-[70] rounded-2xl border border-slate-200/80 bg-white p-3 shadow-float"
    >
      {children}
    </div>,
    document.body,
  );
}
