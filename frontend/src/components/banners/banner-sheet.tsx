"use client";
import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Banner } from "@/types/people";

/** Any wide strip, at any size: width 4 to 12 times the height (1000 x 90 is ideal). The server checks the same rule. */
const MIN_RATIO = 4;
const MAX_RATIO = 12;
const MAX_BYTES = 5 * 1024 * 1024;

/** Checked here first so a wrong picture is refused at once (the server checks again). */
async function pictureProblem(file: File): Promise<string | null> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "Use a PNG, JPEG or WebP picture.";
  if (file.size > MAX_BYTES) return "The picture must be 5 MB or smaller.";
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const { naturalWidth: w, naturalHeight: h } = img;
    const ratio = h ? w / h : 0;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
      return `The picture is ${w} x ${h} (about ${ratio.toFixed(1)} : 1). A banner must be a wide strip, from 4 : 1 to 12 : 1 (for example 2000 x 300 or 1000 x 90).`;
    }
    return null;
  } catch {
    return "That picture could not be read. Try another file.";
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Props = { open: boolean; banner: Banner | null; onClose: () => void; onSaved: () => void };

/** Add or edit a banner for the Gifting OS dashboard: picture, title (alt text), order, on/off, and an optional show-from / until window. */
export function BannerSheet({ open, banner, onClose, onSaved }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [order, setOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null); setPreview(null); setErrors({});
    setTitle(banner?.title ?? ""); setOrder(String(banner?.sortOrder ?? 0));
    setActive(banner?.isActive ?? true); setFrom(banner?.startsOn ?? ""); setUntil(banner?.endsOn ?? "");
  }, [open, banner]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(f: File | null) {
    setErrors((x) => ({ ...x, file: "" }));
    if (!f) return;
    const problem = await pictureProblem(f);
    if (problem) { setFile(null); setPreview(null); return setErrors((x) => ({ ...x, file: problem })); }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!banner && !file) e.file = "Choose a banner picture.";
    const n = Number(order);
    if (!Number.isInteger(n) || n < 0 || n > 9999) e.sortOrder = "Use a whole number from 0 to 9999.";
    if (from && until && until < from) e.endsOn = "The end date is before the start date.";
    if (Object.keys(e).length) return setErrors(e);
    setBusy(true);
    try {
      if (!banner) {
        const form = new FormData();
        form.append("file", file!);
        form.append("sortOrder", String(n));
        form.append("isActive", String(active));
        if (title.trim()) form.append("title", title.trim());
        if (from) form.append("startsOn", from);
        if (until) form.append("endsOn", until);
        await apiClient.post("/admin/banners", form);
        toast.success("Banner added");
      } else {
        if (file) {
          const form = new FormData();
          form.append("file", file);
          await apiClient.put(`/admin/banners/${banner.id}/image`, form);
        }
        await apiClient.patch(`/admin/banners/${banner.id}`, { title: title.trim() || null, sortOrder: n, isActive: active, startsOn: from || null, endsOn: until || null });
        toast.success("Banner saved");
      }
      onClose();
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? banner?.imageUrl ?? null;
  return (
    <Sheet open={open} title={banner ? "Edit banner" : "Add banner"} subtitle="Shown at the top of the Gifting OS dashboard" icon={ImagePlus} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-slate-700">Banner picture{!banner && <span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span>}</span>
          {shown && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed link
            <img src={shown} alt="Banner preview" width={1000} height={90} className="block h-auto w-full rounded-lg border border-slate-200" />
          )}
          <label className="pressable flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-brand hover:bg-brand-soft/40">
            <ImagePlus className="h-4 w-4" />{shown ? "Choose a different picture" : "Choose a picture"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 5 MB. Any wide strip, from 4 : 1 to 12 : 1 at any size (1000 × 90 is ideal; 2000 × 300 also works).{banner ? " Leave it to keep the current picture." : ""}</p>
          {errors.file && <p role="alert" className="text-xs font-medium text-red-600">{errors.file}</p>}
        </div>
        <InputField label="Title (optional)" placeholder="Describes the picture for screen readers" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Order (0 shows first)" type="number" integer min={0} max={9999} value={order} onChange={(e) => { setOrder(e.target.value); setErrors((x) => ({ ...x, sortOrder: "" })); }} error={errors.sortOrder} />
          <DatePicker label="Show from (optional)" value={from} onChange={(d) => { setFrom(d); setErrors((x) => ({ ...x, endsOn: "" })); }} max={until || undefined} />
          <DatePicker label="Show until (optional)" value={until} onChange={(d) => { setUntil(d); setErrors((x) => ({ ...x, endsOn: "" })); }} min={from || undefined} error={errors.endsOn} />
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30" />
          Active (switch off to hide it without deleting)
        </label>
        <Button onClick={() => void save()} loading={busy} className="w-full">{banner ? "Save banner" : "Add banner"}</Button>
      </div>
    </Sheet>
  );
}
