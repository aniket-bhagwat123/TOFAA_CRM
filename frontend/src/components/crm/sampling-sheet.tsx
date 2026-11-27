"use client";
import { FileText, Images, Loader2, Mail, MessageCircle, Package, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { DealData, Quotation, SampleFile, SampleItem, SamplesState } from "@/types/crm";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";

const MAX_FILES = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.docx";
const CELL = "h-9 rounded-lg px-2.5 py-1.5 sm:text-sm";
const OUTLINE_BTN =
  "pressable inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand/40 hover:text-brand disabled:opacity-40";

type Draft = { key: number; packageName: string; itemName: string; description: string; files: SampleFile[]; uploading: number };

let nextKey = 1;
const blank = (packageName = ""): Draft => ({ key: nextKey++, packageName, itemName: "", description: "", files: [], uploading: 0 });
const isImage = (f: SampleFile) => (f.mime ?? "").startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(f.name);

/** Saved samples, or (first time) one row per item of the latest quotation's requirement packages. */
function startingItems(samples: SamplesState | undefined, quote: Quotation | undefined): Draft[] {
  if (samples?.items.length) {
    return samples.items.map((s: SampleItem) => ({ key: nextKey++, packageName: s.packageName ?? "", itemName: s.itemName, description: s.description ?? "", files: s.files, uploading: 0 }));
  }
  const fromQuote = (quote?.packages ?? []).flatMap((p) =>
    p.items.length
      ? p.items.map((i) => ({ ...blank(p.name), itemName: i.name, description: i.description ?? "" }))
      : [{ ...blank(p.name), itemName: p.name }],
  );
  if (fromQuote.length) return fromQuote;
  return (quote?.items ?? []).map((i) => ({ ...blank(), itemName: i.description }));
}

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/**
 * Sampling: sample images and files for each item, sent to the client as secure links (WhatsApp or email).
 * Sending is the action that moves the lead to Sampling.
 */
export function SamplingSheet({ target, onClose, onDone }: Props) {
  const deal = useApi<DealData>(target ? `/leads/${target.leadId}/deal` : null);
  const [items, setItems] = useState<Draft[]>([]);
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [message, setMessage] = useState("");
  const [follow, setFollow] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const loadedFor = useRef<string | null>(null);

  // Fill once per opening, when the deal has loaded.
  useEffect(() => {
    if (!target || !deal.data || loadedFor.current === target.leadId) return;
    loadedFor.current = target.leadId;
    const start = startingItems(deal.data.samples, deal.data.quotations[0]);
    setItems(start.length ? start : [blank()]);
  }, [target, deal.data]);

  useEffect(() => {
    if (target) return;
    loadedFor.current = null;
    setItems([]); setMessage(""); setChannel("whatsapp"); setFollow(nextBusinessDayIso()); setErrors({});
  }, [target]);

  const patch = (key: number, fn: (d: Draft) => Partial<Draft>) => {
    setItems((all) => all.map((d) => (d.key === key ? { ...d, ...fn(d) } : d)));
    setErrors((e) => ({ ...e, [`item-${key}`]: "", samples: "" }));
  };
  const uploading = items.some((d) => d.uploading > 0);
  const fileCount = items.reduce((n, d) => n + d.files.length, 0);
  const lastSent = deal.data?.samples?.lastSent;

  async function upload(key: number, files: File[]) {
    if (!target) return;
    const item = items.find((d) => d.key === key);
    if (!item) return;
    const room = MAX_FILES - item.files.length - item.uploading;
    const good = files.filter((f) => {
      if (f.size > MAX_BYTES) { toast.error(`${f.name}: 10 MB at most`); return false; }
      return true;
    });
    if (good.length > room) toast.error(`Up to ${MAX_FILES} files per item`);
    const batch = good.slice(0, Math.max(room, 0));
    if (!batch.length) return;
    patch(key, (d) => ({ uploading: d.uploading + batch.length }));
    await Promise.all(batch.map(async (file) => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await apiClient.post<SampleFile>(`/leads/${target.leadId}/sample-files`, form, { timeout: 60000 });
        patch(key, (d) => ({ files: [...d.files, res.data], uploading: d.uploading - 1 }));
      } catch (err) {
        toast.error(`${file.name}: ${errorMessage(err)}`);
        patch(key, (d) => ({ uploading: d.uploading - 1 }));
      }
    }));
  }

  /** Checks the list and saves it. Returns false when something needs fixing. */
  async function persist(): Promise<boolean> {
    if (!target) return false;
    const e: Record<string, string> = {};
    const kept = items.filter((d) => d.itemName.trim() || d.files.length || d.description.trim());
    kept.forEach((d, n) => { if (!d.itemName.trim()) e[`item-${d.key}`] = `Item ${n + 1} needs a name`; });
    setErrors(e);
    if (Object.keys(e).length) return false;
    if (uploading) { toast.info("Wait for the files to finish uploading"); return false; }
    await apiClient.put(`/leads/${target.leadId}/samples`, {
      items: kept.map((d) => ({
        packageName: d.packageName.trim() || null, itemName: d.itemName.trim(), description: d.description.trim() || null,
        files: d.files.map(({ path, name, mime }) => ({ path, name, mime })),
      })),
    });
    return true;
  }

  async function save() {
    setBusy("save");
    try {
      if (await persist()) { toast.success("Samples saved"); onDone(); onClose(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!target) return;
    if (!fileCount) { setErrors((e) => ({ ...e, samples: "Upload at least one sample file to send" })); return; }
    if (!follow) { setErrors((e) => ({ ...e, nextFollowUp: "Pick the next follow-up date" })); return; }
    setBusy("send");
    try {
      if (!(await persist())) return;
      const res = await apiClient.post<{ mode: string; url?: string }>(`/leads/${target.leadId}/samples/send`, { channel, nextFollowUp: follow, message: message.trim() || null });
      if (res.data.mode === "click_to_chat" && res.data.url) {
        window.open(res.data.url, "_blank", "noopener");
        toast.success("WhatsApp opened with the sample links. Moved to Sampling.");
      } else toast.success(channel === "email" ? "Samples emailed. Moved to Sampling." : "Samples sent on WhatsApp. Moved to Sampling.");
      onDone();
      onClose();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors((e) => ({ ...e, ...fe }));
      else toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const option = (key: "whatsapp" | "email", label: string, hint: string, Icon: typeof Mail, disabled: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { setChannel(key); setErrors((e) => ({ ...e, channel: "" })); }}
      aria-pressed={channel === key}
      className={cn("pressable flex flex-1 items-start gap-3 rounded-2xl border p-3 text-left disabled:opacity-40", channel === key ? "border-brand bg-brand-soft" : "border-slate-200 hover:bg-slate-50")}
    >
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", channel === key ? "bg-brand text-white" : "bg-slate-100 text-slate-500")}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </button>
  );

  return (
    <Sheet open={!!target} title="Samples" subtitle={target?.name} icon={Images} tone="sky" onClose={onClose} width="xl">
      {deal.loading && !deal.data ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : (
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  <Package className="h-4 w-4 text-brand" aria-hidden="true" /> Items ({items.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {lastSent ? `Last sent by ${lastSent.channel} on ${new Date(lastSent.sentAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}. ` : ""}
                  Upload sample images and files for each item, then send them to the client.
                </p>
              </div>
              <button type="button" className={OUTLINE_BTN} onClick={() => setItems((all) => [...all, blank()])}>
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>

            {items.map((d, n) => (
              <ItemCard
                key={d.key}
                index={n}
                item={d}
                error={errors[`item-${d.key}`]}
                onPatch={(fn) => patch(d.key, fn)}
                onRemove={() => setItems((all) => all.filter((x) => x.key !== d.key))}
                onUpload={(files) => void upload(d.key, files)}
              />
            ))}
            {errors.samples && <p role="alert" className="text-xs font-medium text-red-600">{errors.samples}</p>}
          </section>

          <section className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
            <h3 className="text-sm font-semibold text-slate-800">Send to the client</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              {option("whatsapp", "WhatsApp", target?.phone ? "Message with the sample links" : "No phone number on this lead", MessageCircle, !target?.phone)}
              {option("email", "Email", "Email with the sample links", Mail, false)}
            </div>
            {errors.channel && <p role="alert" className="text-xs font-medium text-red-600">{errors.channel}</p>}
            <TextareaField label="Message (optional)" rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a line for the client" />
            <DateChips label="Next follow-up" required value={follow} onChange={(v) => { setFollow(v); setErrors((e) => ({ ...e, nextFollowUp: "" })); }} error={errors.nextFollowUp} />
          </section>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={save} loading={busy === "save"} disabled={!!busy || uploading} className="sm:flex-1">Save</Button>
            <Button onClick={send} loading={busy === "send"} disabled={!!busy || uploading} className="sm:flex-[2]">
              {uploading ? "Uploading files…" : `Send ${fileCount ? `${fileCount} ${fileCount === 1 ? "file" : "files"} ` : ""}to client`}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

type CardProps = {
  index: number;
  item: Draft;
  error?: string;
  onPatch: (fn: (d: Draft) => Partial<Draft>) => void;
  onRemove: () => void;
  onUpload: (files: File[]) => void;
};

/** One item: its name and description, and the sample images / files for it. */
function ItemCard({ index, item, error, onPatch, onRemove, onUpload }: CardProps) {
  const no = index + 1;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const full = item.files.length + item.uploading >= MAX_FILES;
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!full) onUpload(Array.from(e.dataTransfer.files));
  };

  return (
    <div className={cn("space-y-3 rounded-2xl border bg-slate-50/70 p-3 sm:p-4", error ? "border-red-300" : "border-slate-200")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 rounded-md bg-sky-100 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide text-sky-800 ring-1 ring-sky-200">Item {no}</span>
        {item.packageName && <span className="truncate text-xs font-medium text-slate-500">{item.packageName}</span>}
        <button type="button" onClick={onRemove} className="pressable ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" /> Remove
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <InputField hideLabel label={`Item ${no} name`} placeholder="Item name" value={item.itemName} onChange={(e) => onPatch(() => ({ itemName: e.target.value }))} className={CELL} />
        <InputField hideLabel label={`Item ${no} description`} placeholder="Description (optional)" value={item.description} onChange={(e) => onPatch(() => ({ description: e.target.value }))} className={CELL} />
      </div>

      {(item.files.length > 0 || item.uploading > 0) && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {item.files.map((f) => (
            <li key={f.path} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
              {isImage(f) && f.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt={f.name} className="h-full w-full object-cover" />
              ) : (
                <a href={f.url ?? undefined} target="_blank" rel="noopener noreferrer" className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-slate-500 hover:text-brand">
                  <FileText className="h-6 w-6" />
                  <span className="line-clamp-2 break-all text-[11px] leading-tight">{f.name}</span>
                </a>
              )}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onPatch((d) => ({ files: d.files.filter((x) => x.path !== f.path) }))} className="pressable absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-red-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {Array.from({ length: item.uploading }, (_, i) => (
            <li key={`up-${i}`} className="flex aspect-square items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" aria-label="Uploading" />
            </li>
          ))}
        </ul>
      )}

      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {!full && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3.5 text-xs transition-colors",
            dragging ? "border-brand bg-brand-soft text-brand" : "border-slate-300 bg-white text-slate-500 hover:border-brand/50",
          )}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Drag &amp; drop images or files for item {no}, or click to upload (PDF, Word, JPEG, PNG, WebP; 10 MB each)
        </button>
      )}
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
