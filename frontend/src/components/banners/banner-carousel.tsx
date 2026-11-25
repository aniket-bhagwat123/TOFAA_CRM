"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi } from "@/hooks/use-api";
import type { Banner } from "@/types/people";

const ROTATE_MS = 8000;

/**
 * The banner strip at the top of the Dashboard (KAM and admin). One 1000 x 90 picture at a time; with two or more it
 * moves on every 8 seconds and pauses while the pointer is over it. Nothing is shown when there are no live banners.
 */
export function BannerCarousel() {
  const list = useApi<Banner[]>("/banners");
  const banners = (list.data ?? []).filter((b) => b.imageUrl);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (count < 2 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused]);

  if (!count) return null;
  const b = banners[Math.min(index, count - 1)];
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  return (
    <section
      aria-roledescription="carousel" aria-label="Announcements"
      className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-card"
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link, shown as is */}
      <img src={b.imageUrl!} alt={b.title || "Announcement"} width={1000} height={90} className="block h-auto w-full" />
      {count > 1 && (
        <>
          <button type="button" aria-label="Previous banner" onClick={() => go(-1)}
            className="pressable absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" aria-label="Next banner" onClick={() => go(1)}
            className="pressable absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow transition-opacity hover:bg-white focus-visible:opacity-100 group-hover:opacity-100">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span aria-live="polite" className="absolute bottom-1.5 right-2 rounded-full bg-slate-900/60 px-2 py-0.5 text-[10px] font-semibold text-white">
            {index + 1} / {count}
          </span>
        </>
      )}
    </section>
  );
}
