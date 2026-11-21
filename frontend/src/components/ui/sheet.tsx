"use client";
import { createPortal } from "react-dom";
import { animate, motionValue, type AnimationPlaybackControls } from "motion";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DialogHeader, type Tone } from "./dialog-header";

type Props = { open: boolean; title: string; subtitle?: string; icon?: LucideIcon; tone?: Tone; onClose: () => void; children: ReactNode; width?: "md" | "lg" | "xl" };

const WIDTH = { md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl" };

// Critically damped by default; a little bounce only when a flick carried momentum.
const SETTLE = { type: "spring", bounce: 0, duration: 0.42 } as const;
const FLICK = { type: "spring", bounce: 0.2, duration: 0.42 } as const;
const DECELERATION = 0.998;

/** How far a gesture would coast at this release velocity (px/s). Same exponential decay as scrolling. */
const project = (v: number) => ((v / 1000) * DECELERATION) / (1 - DECELERATION);

/** The further past the edge, the less the sheet follows: soft resistance, not a hard stop. */
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Bottom sheet on phones, centred dialog on larger screens.
 *
 * Phones: the sheet tracks the finger 1:1 (from where it was grabbed), and on release it projects the
 * momentum to decide whether to dismiss, handing the finger's velocity to a spring. It can be grabbed
 * again mid-flight: every animation starts from the live on-screen value.
 */
export function Sheet({ open, title, subtitle, icon, tone, onClose, children, width = "md" }: Props) {
  const [mounted, setMounted] = useState(open);
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const y = useRef(motionValue(0));
  const run = useRef<AnimationPlaybackControls | null>(null);
  const drag = useRef<{ grab: number; startY: number; history: { y: number; t: number }[] } | null>(null);
  const releaseVelocity = useRef(0);
  const height = useRef(600);

  const paint = useCallback((v: number) => {
    if (!panel.current || !scrim.current) return;
    panel.current.style.transform = `translate3d(0, ${v}px, 0)`;
    scrim.current.style.opacity = String(Math.max(0, Math.min(1, 1 - v / height.current)));
  }, []);

  useEffect(() => y.current.on("change", paint), [paint]);

  // Mount on open; unmount only after the exit animation has finished.
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted || !panel.current || !scrim.current) return;
    const el = panel.current;
    height.current = el.offsetHeight || 600;
    run.current?.stop();

    if (!isPhone() || reducedMotion()) {
      // Desktop: a dialog in the middle of the screen that grows out of the centre and settles with a spring.
      // Reduced motion: a short fade.
      const from = open ? 0 : 1;
      const to = open ? 1 : 0;
      el.style.transform = "none";
      const a = reducedMotion()
        ? animate(el, { opacity: [from, to] }, { duration: 0.15 })
        : animate(el, { opacity: [from, to], scale: open ? [0.95, 1] : [1, 0.97], y: open ? [12, 0] : [0, 8] }, SETTLE);
      const b = animate(scrim.current, { opacity: [from, to] }, { duration: 0.2 });
      a.finished.then(() => !open && setMounted(false));
      void b;
      return;
    }

    if (open) {
      el.style.opacity = "1";
      y.current.set(height.current); // start fully below, then spring up
      run.current = animate(y.current, 0, SETTLE);
    } else {
      // Exit from wherever the sheet is right now, carrying the finger's last velocity.
      run.current = animate(y.current, height.current, { ...SETTLE, velocity: releaseVelocity.current });
      run.current.finished.then(() => setMounted(false));
    }
    return () => run.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Escape closes. Body does not scroll behind the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  function onPointerDown(e: React.PointerEvent) {
    if (!isPhone() || !open) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    run.current?.stop(); // grab it mid-flight: no waiting for the animation to finish
    const live = y.current.get(); // the on-screen value, not the target
    drag.current = { grab: e.clientY, startY: live, history: [{ y: e.clientY, t: performance.now() }] };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const raw = d.startY + (e.clientY - d.grab); // 1:1, offset from where it was grabbed
    y.current.set(raw >= 0 ? raw : -rubberband(-raw, height.current));
    d.history.push({ y: e.clientY, t: performance.now() });
    if (d.history.length > 6) d.history.shift();
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const first = d.history[0];
    const last = d.history[d.history.length - 1];
    const v = last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0; // px/s
    const here = y.current.get();
    const projected = here + project(v); // where the gesture is going, not where it stopped
    if (projected > height.current * 0.5 || v > 900) {
      releaseVelocity.current = v;
      onClose(); // the exit effect springs it away from the live value
    } else {
      run.current = animate(y.current, 0, { ...(v > 300 || v < -300 ? FLICK : SETTLE), velocity: v });
    }
  }

  if (!mounted || typeof document === "undefined") return null;
  // Rendered into <body>: a transformed or animated ancestor would otherwise trap "fixed" inside itself and the
  // scrim would stop short of the window edges.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <div ref={scrim} className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-white shadow-sheet sm:max-h-[88vh] sm:rounded-3xl ${WIDTH[width]}`}
        style={{ transform: "translate3d(0,100%,0)" }}
      >
        {/* Grab zone: handle and title. Dragging here moves the sheet; the form below scrolls normally. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="sticky top-0 z-10 touch-none select-none border-b border-slate-100 bg-white sm:touch-auto"
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
          <DialogHeader title={title} subtitle={subtitle} icon={icon} tone={tone} onClose={onClose} />
        </div>
        <div className="px-5 pb-8 pt-5 sm:pb-6">{children}</div>
      </div>
    </div>,
    document.body,

  );
}
