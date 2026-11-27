"use client";
import { Crop, ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BannerCrop } from "@/components/banners/banner-crop";
import { BannerClients } from "@/components/banners/banner-clients";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { BANNER_HEIGHT, BANNER_WIDTH } from "@/lib/banner-crop";
import { useAppSelector } from "@/store/hooks";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Banner } from "@/types/people";

const MAX_INPUT_BYTES = 15 * 1024 * 1024; // the cropped picture that is uploaded is far smaller

type Props = { open: boolean; banner: Banner | null; onClose: () => void; onSaved: () => void };

/** Add or edit a banner for the Gifting OS dashboard: picture (cropped here), which clients see it, title (alt text),
 * order, on/off, and an optional show-from / until window. */
export function BannerSheet({ open, banner, onClose, onSaved }: Props) {
  const isAdmin = useAppSelector((s) => s.auth.session?.profile.role) === "admin"; // only an admin posts to every client
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null); // the picture as chosen, for cropping again
  const [cropping, setCropping] = useState(false);
  const [everyone, setEveryone] = useState(true);
  const [clients, setClients] = useState<string[]>([]);
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
    setFile(null); setPreview(null); setErrors({}); setSource(null); setCropping(false);
    setEveryone(isAdmin && !banner?.companyIds?.length); setClients(banner?.companyIds ?? []);
    setTitle(banner?.title ?? ""); setOrder(String(banner?.sortOrder ?? 0));
    setActive(banner?.isActive ?? true); setFrom(banner?.startsOn ?? ""); setUntil(banner?.endsOn ?? "");
  }, [open, banner, isAdmin]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | null) {
    setErrors((x) => ({ ...x, file: "" }));
    if (!f) return;
    const problem = !["image/png", "image/jpeg", "image/webp"].includes(f.type) ? "Use a PNG, JPEG or WebP picture."
      : f.size > MAX_INPUT_BYTES ? "That picture is too large. Pick one under 15 MB." : "";
    if (problem) return setErrors((x) => ({ ...x, file: problem }));
    setSource(f);
    setCropping(true);
  }
  function cropped(result: File) {
    setFile(result);
    setPreview(URL.createObjectURL(result));
    setCropping(false);
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!banner && !file) e.file = "Choose a banner picture.";
    const chosen = everyone ? [] : clients;
    if (!everyone && !chosen.length) e.companyIds = "Choose at least one client.";
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
        chosen.forEach((id) => form.append("companyIds", id));
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
        await apiClient.patch(`/admin/banners/${banner.id}`, { title: title.trim() || null, sortOrder: n, isActive: active, startsOn: from || null, endsOn: until || null, companyIds: chosen });
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
    <>
    <Sheet open={open} title={banner ? "Edit banner" : "Add banner"} subtitle="Shown at the top of the Gifting OS dashboard" icon={ImagePlus} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-slate-700">Banner picture{!banner && <span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span>}</span>
          {shown && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed link
            <img src={shown} alt="Banner preview" width={BANNER_WIDTH} height={BANNER_HEIGHT} className="block h-auto w-full rounded-lg border border-slate-200" />
          )}
          <label className="pressable flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 hover:border-brand hover:bg-brand-soft/40">
            <ImagePlus className="h-4 w-4" />{shown ? "Choose a different picture" : "Choose a picture"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </label>
          {source && <button type="button" onClick={() => setCropping(true)} className="pressable inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><Crop className="h-4 w-4" />Adjust crop</button>}
          <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 15 MB. You crop it to {BANNER_WIDTH} × {BANNER_HEIGHT} before it is uploaded.{banner ? " Leave it to keep the current picture." : ""}</p>
          {errors.file && <p role="alert" className="text-xs font-medium text-red-600">{errors.file}</p>}
        </div>
        <BannerClients allowEveryone={isAdmin} everyone={everyone} onEveryone={(value) => { setEveryone(value); setErrors((x) => ({ ...x, companyIds: "" })); }}
          chosen={clients} onChosen={(ids) => { setClients(ids); setErrors((x) => ({ ...x, companyIds: "" })); }} known={banner?.clients} error={errors.companyIds} />
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
    {open && cropping && source && <BannerCrop file={source} onCancel={() => setCropping(false)} onDone={cropped} />}
    </>
  );
}
