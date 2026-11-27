"use client";
/**
 * Crop a chosen picture to the banner size. The frame has the banner's shape: drag the picture to place it, zoom with the
 * slider (or the mouse wheel), and the part inside the frame is saved as exactly 2156 × 198.
 */
import { Crop, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cropArea, BANNER_HEIGHT, BANNER_WIDTH } from "@/lib/banner-crop";

const MAX_ZOOM = 5;

export function BannerCrop({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (cropped: File) => void }) {
  const [url, setUrl] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [centre, setCentre] = useState({ x: 0.5, y: 0.5 }); // of the picture, 0 to 1
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next); setSize(null); setZoom(1); setCentre({ x: 0.5, y: 0.5 }); setError("");
    return () => URL.revokeObjectURL(next);
  }, [file]);
  useEffect(() => { // Escape closes only this window, not the form underneath
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); onCancel(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel]);

  const area = size ? cropArea(size.w, size.h, zoom, centre) : null;
  /** Moves the frame by a distance in picture pixels, kept inside the picture. */
  const move = (dx: number, dy: number) => {
    if (!size) return;
    setCentre((c) => {
      const next = cropArea(size.w, size.h, zoom, { x: c.x + dx / size.w, y: c.y + dy / size.h });
      return { x: (next.x + next.width / 2) / size.w, y: (next.y + next.height / 2) / size.h };
    });
  };
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !area) return;
    const scale = area.width / e.currentTarget.clientWidth;
    move((drag.current.x - e.clientX) * scale, (drag.current.y - e.clientY) * scale);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = area ? area.width / 100 : 0;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (by[e.key]) { e.preventDefault(); move(...by[e.key]); }
  }

  async function use() {
    if (!area || !image.current) return;
    setBusy(true); setError("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = BANNER_WIDTH;
      canvas.height = BANNER_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error();
      ctx.fillStyle = "#fff"; // transparent pictures become white instead of black
      ctx.fillRect(0, 0, BANNER_WIDTH, BANNER_HEIGHT);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image.current, area.x, area.y, area.width, area.height, 0, 0, BANNER_WIDTH, BANNER_HEIGHT);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error();
      onDone(new File([blob], "banner.jpg", { type: "image/jpeg" }));
    } catch {
      setError("That picture could not be cropped. Try another one.");
    } finally {
      setBusy(false);
    }
  }

  const soft = area && area.width < BANNER_WIDTH * 0.8;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-3 sm:p-6">
      <div role="dialog" aria-modal="true" aria-label="Crop banner" className="animate-rise flex max-h-full w-full max-w-5xl flex-col overflow-y-auto rounded-3xl bg-white shadow-float">
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Crop className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-slate-900">Crop banner</h2><p className="text-sm text-slate-500">Drag the picture to place it inside the frame, and zoom if needed. Saved as {BANNER_WIDTH} × {BANNER_HEIGHT}.</p></div>
          <button type="button" aria-label="Close" onClick={onCancel} className="pressable rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <div
            tabIndex={0} role="group" aria-label="Banner frame. Drag, or use the arrow keys, to move the picture."
            className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-lg bg-slate-100 ring-2 ring-brand/60 focus:outline-none focus-visible:ring-4 active:cursor-grabbing"
            style={{ aspectRatio: `${BANNER_WIDTH} / ${BANNER_HEIGHT}` }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }}
            onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onWheel={(e) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(1, z - e.deltaY / 500)))}
            onKeyDown={onKeyDown}
          >
            {url && (
              // eslint-disable-next-line @next/next/no-img-element -- a local file being cropped
              <img ref={image} src={url} alt="Picture being cropped" draggable={false} className="pointer-events-none absolute max-w-none"
                style={area && size ? { width: `${(size.w / area.width) * 100}%`, left: `${(-area.x / area.width) * 100}%`, top: `${(-area.y / area.height) * 100}%` } : { visibility: "hidden" }}
                onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setError("That picture could not be read. Try another file.")} />
            )}
          </div>
          <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <ZoomIn className="h-4 w-4 shrink-0 text-slate-500" />Zoom
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="min-w-0 flex-1 accent-brand" />
          </label>
          {soft && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">The part you chose is smaller than {BANNER_WIDTH} × {BANNER_HEIGHT}, so it may look soft. Zoom out or use a larger picture.</p>}
          {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-100 px-5 py-3">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="button" loading={busy} disabled={!area} onClick={() => void use()}>Crop and use</Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
