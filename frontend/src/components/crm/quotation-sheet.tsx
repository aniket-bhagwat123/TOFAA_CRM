"use client";
import { Box, Boxes, FileText, ImageIcon, Layers, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileButton } from "@/components/ui/file-button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { inr, quoteTotals } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { DealData, Quotation, QuotationPhoto, QuotationTemplate } from "@/types/crm";
import type { LeadTarget } from "./types";

const MAX_PACKAGES = 20;
const MAX_ITEMS = 50;
export const MAX_PACKAGE_PHOTOS = 10;
const MAX_PHOTOS = MAX_PACKAGE_PHOTOS;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Inputs inside a package are compact, so a package reads as one card and not a stack of forms.
const CELL = "h-9 rounded-lg px-2.5 py-1.5 sm:text-sm";
const SMALL_LABEL = "mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500";
export const OUTLINE_BTN =
  "pressable inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand/40 hover:text-brand disabled:opacity-40";

/** The last four are asked only on the agreement: the OMS handover is filled from them. */
export type ItemDraft = { name: string; description: string; unitPrice?: string; id?: number; quantityPerKit?: string; isPackaging?: boolean; productId?: string; photos?: QuotationPhoto[] };
export type PackageDraft = { key: number; name: string; unitPrice: string; quantity: string; items: ItemDraft[]; photos: QuotationPhoto[]; uploading: number };

let nextKey = 1;
export const blankItem = (): ItemDraft => ({ name: "", description: "", id: nextKey++ });
export const blankPackage = (): PackageDraft => ({ key: nextKey++, name: "", unitPrice: "", quantity: "", items: [blankItem()], photos: [], uploading: 0 });

/** Packages as the API stores them (an agreement's, for example) turned back into drafts. */
type StoredItem = { name: string; description?: string | null; unitPrice?: number | null; quantityPerKit?: number | null; isPackaging?: boolean; productId?: string | null; photos?: QuotationPhoto[] };
export function fromPackages(list: { name: string; unitPrice?: number; unit_price?: number; quantity: number; items?: StoredItem[]; photos?: QuotationPhoto[] }[]): PackageDraft[] {
  return list.map((p) => ({
    key: nextKey++, name: p.name, unitPrice: String(p.unitPrice ?? p.unit_price ?? ""), quantity: String(p.quantity),
    items: p.items?.length ? p.items.map((i) => ({
      id: nextKey++, name: i.name, description: i.description ?? "", unitPrice: i.unitPrice == null ? "" : String(i.unitPrice), quantityPerKit: i.quantityPerKit ? String(i.quantityPerKit) : "",
      isPackaging: !!i.isPackaging, productId: i.productId ?? "", photos: i.photos ?? [],
    })) : [blankItem()],
    photos: p.photos ?? [], uploading: 0,
  }));
}

// The server's limits (quotations/schemas.py).
const NAME_MAX = 120;
const DESCRIPTION_MAX = 300;
const tooLong = (value: string, max: number) => (value.trim().length > max ? `Use at most ${max} characters (now ${value.trim().length}).` : undefined);
const hasLongText = (p: PackageDraft) => !!tooLong(p.name, NAME_MAX) || p.items.some((i) => tooLong(i.name, NAME_MAX) || tooLong(i.description, DESCRIPTION_MAX));

const hasRate = (i: ItemDraft) => (i.unitPrice ?? "").trim() !== "";
/** True when items are priced one by one (then the requirement's rate is worked out from them). */
export const pricedByItem = (items: ItemDraft[]) => items.some(hasRate);
const setRate = (items: ItemDraft[]) => String(Math.round(items.filter((i) => i.name.trim() || hasRate(i))
  .reduce((sum, i) => sum + (Number(i.unitPrice) || 0) * (Number(i.quantityPerKit) || 1), 0) * 100) / 100);
/** A change to the items, with the requirement's rate following the item rates. */
const withItems = (items: ItemDraft[]) => ({ items, ...(pricedByItem(items) ? { unitPrice: setRate(items) } : {}) });
const missingRate = (p: PackageDraft) => pricedByItem(p.items) && p.items.some((i) => i.name.trim() && !hasRate(i));

/** Checks the packages the way the quotation does. Returns field errors keyed `pkg-<key>`. */
export function packageErrors(packages: PackageDraft[]): Record<string, string> {
  const e: Record<string, string> = {};
  packages.forEach((p, n) => {
    const label = `Requirement ${n + 1}`;
    const items = p.items.filter((i) => i.name.trim() || i.description.trim() || i.photos?.length);
    if (!p.name.trim()) e[`pkg-${p.key}`] = `${label} needs a name`;
    else if (p.unitPrice === "" || Number(p.unitPrice) < 0) e[`pkg-${p.key}`] = `${label} needs a rate per unit`;
    else if (!(Number(p.quantity) > 0)) e[`pkg-${p.key}`] = `${label}: quantity must be greater than 0`;
    else if (items.some((i) => !i.name.trim())) e[`pkg-${p.key}`] = `${label}: every item needs a name`;
    else if (hasLongText(p)) e[`pkg-${p.key}`] = `${label}: shorten the fields marked above`;
    else if (missingRate(p)) e[`pkg-${p.key}`] = `${label}: give every item a rate, or none of them`;
  });
  return e;
}

/** Packages in the shape the API takes. */
export const packagesPayload = (packages: PackageDraft[]) =>
  packages.map((p) => ({
    name: p.name.trim(), unitPrice: Number(p.unitPrice), quantity: Number(p.quantity),
    items: p.items.filter((i) => i.name.trim()).map((i) => ({
      name: i.name.trim(), description: i.description.trim() || null, unitPrice: hasRate(i) ? Number(i.unitPrice) : null, quantityPerKit: Number(i.quantityPerKit) || null,
      isPackaging: !!i.isPackaging, productId: i.productId?.trim() || null, photos: (i.photos ?? []).map((x) => x.path),
    })),
    photos: p.photos.map((x) => x.path),
  }));

/** A revision starts from the latest version. A version made from flat line items becomes one package per line. */
export function fromQuotation(q: Quotation): PackageDraft[] {
  if (q.packages?.length) {
    return q.packages.map((p) => ({
      key: nextKey++, name: p.name, unitPrice: String(p.unitPrice), quantity: String(p.quantity),
      items: p.items.length ? p.items.map((i) => ({ id: nextKey++, name: i.name, description: i.description ?? "", unitPrice: i.unitPrice == null ? "" : String(i.unitPrice) })) : [blankItem()],
      photos: p.photos, uploading: 0,
    }));
  }
  return q.items.map((i) => ({ key: nextKey++, name: i.description, unitPrice: String(i.unitPrice), quantity: String(i.quantity), items: [blankItem()], photos: [], uploading: 0 }));
}

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void; onCreated: (q: Quotation) => void };

/** Build a quotation from client requirement packages. Creating a new one after a version exists starts from that version (a revision). */
export function QuotationSheet({ target, onClose, onDone, onCreated }: Props) {
  const deal = useApi<DealData>(target ? `/leads/${target.leadId}/deal` : null);
  const templates = useApi<QuotationTemplate[]>(target ? "/quotation-templates" : null);
  const [packages, setPackages] = useState<PackageDraft[]>(() => [blankPackage()]);
  const [templateId, setTemplateId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const latest = deal.data?.quotations[0];

  useEffect(() => {
    if (!target || !latest) return;
    const drafts = fromQuotation(latest);
    setPackages(drafts.length ? drafts : [blankPackage()]);
    setNotes(latest.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, !!target]);

  useEffect(() => {
    if (templates.data && !templateId) setTemplateId(templates.data.find((t) => t.isDefault)?.id ?? templates.data[0]?.id ?? "");
  }, [templates.data, templateId]);

  useEffect(() => {
    if (target) return;
    setPackages([blankPackage()]); setNotes(""); setErrors({});
  }, [target]);

  const totals = quoteTotals(packages, "0");
  const uploading = packages.some((p) => p.uploading > 0);

  const patchPackage = (key: number, patch: (p: PackageDraft) => Partial<PackageDraft>) => {
    setPackages((all) => all.map((p) => (p.key === key ? { ...p, ...patch(p) } : p)));
    setErrors((e) => ({ ...e, [`pkg-${key}`]: "", packages: "" }));
  };

  async function uploadPhotos(key: number, files: File[]) {
    if (!target) return;
    const pkg = packages.find((p) => p.key === key);
    if (!pkg) return;
    const room = MAX_PHOTOS - pkg.photos.length - pkg.uploading;
    const good = files.filter((f) => {
      if (!PHOTO_TYPES.includes(f.type)) { toast.error(`${f.name}: use a JPEG, PNG or WebP image`); return false; }
      if (f.size > MAX_PHOTO_BYTES) { toast.error(`${f.name}: each photo must be 5 MB or smaller`); return false; }
      return true;
    });
    if (good.length > room) toast.error(`Up to ${MAX_PHOTOS} photos per requirement`);
    const batch = good.slice(0, Math.max(room, 0));
    if (!batch.length) return;
    patchPackage(key, (p) => ({ uploading: p.uploading + batch.length }));
    await Promise.all(
      batch.map(async (file) => {
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await apiClient.post<QuotationPhoto>(`/leads/${target.leadId}/quotation-photos`, form, { timeout: 60000 });
          patchPackage(key, (p) => ({ photos: [...p.photos, res.data], uploading: p.uploading - 1 }));
        } catch (err) {
          toast.error(`${file.name}: ${errorMessage(err)}`);
          patchPackage(key, (p) => ({ uploading: p.uploading - 1 }));
        }
      }),
    );
  }

  async function save() {
    if (!target) return;
    const e: Record<string, string> = packageErrors(packages);
    if (!Object.keys(e).length && totals.total <= 0) e.packages = "The total must be greater than 0";
    setErrors(e);
    if (Object.keys(e).length) return;
    if (uploading) { toast.info("Wait for the photos to finish uploading"); return; }

    setBusy(true);
    try {
      const res = await apiClient.post<Quotation>(`/leads/${target.leadId}/quotations`, {
        templateId: templateId || null,
        packages: packages.map((p) => ({
          name: p.name.trim(),
          unitPrice: Number(p.unitPrice),
          quantity: Number(p.quantity),
          items: p.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), description: i.description.trim() || null, unitPrice: (i.unitPrice ?? "").trim() === "" ? null : Number(i.unitPrice) })),
          photos: p.photos.map((x) => x.path),
        })),
        notes: notes.trim() || null,
      });
      const q = res.data;
      toast.success(`Quotation v${q.version} ready`);
      onClose();
      onDone();
      onCreated(q);
    } catch (err) {
      const fe = fieldErrors(err);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title={latest ? `New version (v${latest.version + 1})` : "New quotation"} subtitle={target?.name} icon={FileText} tone="violet" onClose={onClose} width="xl">
      <div className="space-y-5">
        {templates.data && templates.data.length > 1 && (
          <SelectField label="Template" value={templateId} options={templates.data.map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setTemplateId(e.target.value)} />
        )}

        <section className="space-y-3">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-800">
                <Layers className="h-4 w-4 text-brand" aria-hidden="true" />
                Client requirement packages ({packages.length})
                <span className="font-semibold text-red-600" aria-hidden="true">*</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">Each requirement holds its own unit pricing, gifting items and approved visual mockups.</p>
            </div>
            <button type="button" className={OUTLINE_BTN} disabled={packages.length >= MAX_PACKAGES} onClick={() => setPackages((all) => [...all, blankPackage()])}>
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Add requirement package</span><span className="sm:hidden">Add</span>
            </button>
          </div>

          {packages.map((p, n) => (
            <PackageCard
              key={p.key}
              index={n}
              pkg={p}
              error={errors[`pkg-${p.key}`]}
              canRemove={packages.length > 1}
              onPatch={(patch) => patchPackage(p.key, patch)}
              onRemove={() => setPackages((all) => all.filter((x) => x.key !== p.key))}
              onUpload={(files) => void uploadPhotos(p.key, files)}
            />
          ))}
          {errors.packages && <p role="alert" className="text-xs font-medium text-red-600">{errors.packages}</p>}
        </section>

        <TextareaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes for the client" />

        <div className="space-y-1 rounded-2xl bg-slate-50 p-4 text-sm">
          {packages.map((p, n) => (
            <div key={p.key} className="flex justify-between gap-3 text-slate-500">
              <span className="truncate">{p.name.trim() || `Requirement ${n + 1}`}</span>
              <span className="tabular-nums">{inr((Number(p.quantity) || 0) * (Number(p.unitPrice) || 0))}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><span>Total</span><span className="tabular-nums">{inr(totals.total)}</span></div>
        </div>

        <Button onClick={save} loading={busy} disabled={uploading} className="w-full">
          {uploading ? "Uploading photos…" : "Save quotation"}
        </Button>
      </div>
    </Sheet>
  );
}

type CardProps = {
  index: number;
  pkg: PackageDraft;
  error?: string;
  canRemove: boolean;
  onPatch: (patch: (p: PackageDraft) => Partial<PackageDraft>) => void;
  onRemove: () => void;
  onUpload: (files: File[]) => void;
  /** Given on the agreement: each item then also takes its quantity per kit, packaging and photos. */
  kit?: { uploading: Record<number, number>; onItemPhotos: (itemId: number, files: File[]) => void };
};

/** What the OMS handover needs about one item, taken with the agreement. */
function ItemKitFields({ label, item, uploading, onChange, onPhotos }: { label: string; item: ItemDraft; uploading: number; onChange: (patch: Partial<ItemDraft>) => void; onPhotos: (files: File[]) => void }) {
  const photos = item.photos ?? [];
  return (
    <div className="w-full space-y-2 pb-1 pl-7">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-24">
          <InputField hideLabel label={`${label} quantity per kit`} title="Quantity per kit (1 if empty)" placeholder="Per kit" type="number" integer value={item.quantityPerKit ?? ""} onChange={(e) => onChange({ quantityPerKit: e.target.value })} className={CELL} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" checked={!!item.isPackaging} onChange={(e) => onChange({ isPackaging: e.target.checked })} />Packaging (box, sleeve, insert)</label>
        <FileButton className="ml-auto" accept={PHOTO_TYPES.join(",")} multiple disabled={photos.length + uploading >= MAX_PHOTOS} onFiles={onPhotos}>Item photos</FileButton>
      </div>
      {(photos.length > 0 || uploading > 0) && (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {photos.map((ph, n) => (
            <li key={ph.path} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
              {ph.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a signed storage link
                <img src={ph.url} alt={`${label} photo ${n + 1}`} className="h-full w-full object-cover" />
              ) : <span className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></span>}
              <button type="button" aria-label={`Remove ${label} photo ${n + 1}`} onClick={() => onChange({ photos: photos.filter((x) => x.path !== ph.path) })} className="pressable absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-red-600"><X className="h-3 w-3" /></button>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, n) => <li key={`up-${n}`} className="flex aspect-square items-center justify-center rounded-lg border border-slate-200 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" /></li>)}
        </ul>
      )}
    </div>
  );
}

/** One client requirement: name, rate x quantity, the items inside it and its mockup photos. */
export function PackageCard({ index, pkg, error, canRemove, onPatch, onRemove, onUpload, kit }: CardProps) {
  const no = index + 1;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const subtotal = (Number(pkg.quantity) || 0) * (Number(pkg.unitPrice) || 0);
  const full = pkg.photos.length + pkg.uploading >= MAX_PHOTOS;

  const setItem = (i: number, patch: Partial<ItemDraft>) => onPatch((p) => withItems(p.items.map((x, n) => (n === i ? { ...x, ...patch } : x))));
  const byItem = pricedByItem(pkg.items);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!full) onUpload(Array.from(e.dataTransfer.files));
  };

  return (
    <div className={cn("space-y-4 rounded-2xl border bg-slate-50/70 p-3 sm:p-4", error ? "border-red-300" : "border-slate-200")}>
      {/* name */}
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
        <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">Requirement {no}</span>
        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
          <InputField hideLabel label={`Requirement ${no} name`} error={tooLong(pkg.name, NAME_MAX)} placeholder="Enter requirement name" value={pkg.name} onChange={(e) => onPatch(() => ({ name: e.target.value }))} className={CELL} />
        </div>
        <button type="button" onClick={onRemove} disabled={!canRemove} className="pressable ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400">
          <Trash2 className="h-3.5 w-3.5" /> Remove package
        </button>
      </div>

      {/* pricing */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <div>
          <span className={SMALL_LABEL} aria-hidden="true">Rate / unit (₹)</span>
          <InputField hideLabel label={`Requirement ${no} rate per unit`} type="number" placeholder="0" disabled={byItem} title={byItem ? "Worked out from the item rates" : undefined} value={pkg.unitPrice} onChange={(e) => onPatch(() => ({ unitPrice: e.target.value }))} className={CELL} />
        </div>
        <div>
          <span className={SMALL_LABEL} aria-hidden="true">Quantity (pcs)</span>
          <InputField hideLabel label={`Requirement ${no} quantity`} type="number" integer placeholder="0" value={pkg.quantity} onChange={(e) => onPatch(() => ({ quantity: e.target.value }))} className={CELL} />
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-emerald-700">Package subtotal</span>
          <span className="mt-0.5 block truncate text-lg font-bold tabular-nums text-emerald-700">{inr(subtotal)}</span>
        </div>
      </div>

      {/* items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <Boxes className="h-4 w-4 text-slate-500" aria-hidden="true" /> Items in requirement {no} ({pkg.items.length})
          </h4>
          <button type="button" className={OUTLINE_BTN} disabled={pkg.items.length >= MAX_ITEMS} onClick={() => onPatch((p) => ({ items: [...p.items, blankItem()] }))}>
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
        <p className="text-xs text-slate-500">{byItem ? "Priced item by item: the rate per unit above is the total of the item rates." : "One common price: leave the item rates empty. Fill them to price each item separately."}</p>
        {pkg.items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-center text-xs text-slate-400">No items yet. Add the gifting items in this requirement.</p>
        ) : (
          <ol className="space-y-2">
            {pkg.items.map((it, i) => (
              <li key={it.id ?? i} className="flex flex-wrap items-start gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 sm:px-2.5">
                <span className="w-5 shrink-0 pt-2.5 text-center text-xs font-medium text-slate-400">{i + 1}</span>
                <div className="w-[38%] shrink-0">
                  <InputField hideLabel label={`Requirement ${no} item ${i + 1} name`} error={tooLong(it.name, NAME_MAX)} placeholder="Item" value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className={CELL} />
                </div>
                <div className="min-w-0 flex-1">
                  <InputField hideLabel label={`Requirement ${no} item ${i + 1} description`} error={tooLong(it.description, DESCRIPTION_MAX)} placeholder="Description" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} className={CELL} />
                </div>
                <div className="w-24 shrink-0">
                  <InputField hideLabel label={`Requirement ${no} item ${i + 1} rate`} title="Rate of one piece (leave empty on every item for one common price)" placeholder="Rate ₹" type="number" value={it.unitPrice ?? ""} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className={CELL} />
                </div>
                <button type="button" aria-label={`Remove item ${i + 1}`} title="Remove item" onClick={() => onPatch((p) => withItems(p.items.filter((_, n) => n !== i)))} className="pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
                {kit && it.id != null && (
                  <ItemKitFields label={`Requirement ${no} item ${i + 1}`} item={it} uploading={kit.uploading[it.id] ?? 0}
                    onChange={(patch) => setItem(i, patch)} onPhotos={(files) => kit.onItemPhotos(it.id!, files)} />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* mockup photos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <Box className="h-4 w-4 text-slate-500" aria-hidden="true" /> Mockup photos for requirement {no} ({pkg.photos.length})
          </h4>
          <button type="button" className={OUTLINE_BTN} disabled={full} onClick={() => fileInput.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Upload photos
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(e) => { onUpload(Array.from(e.target.files ?? [])); e.target.value = ""; }}
          />
        </div>

        {(pkg.photos.length > 0 || pkg.uploading > 0) && (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {pkg.photos.map((ph, i) => (
              <li key={ph.path} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
                {ph.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ph.url} alt={`Requirement ${no} mockup ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-6 w-6" /></span>
                )}
                <button type="button" aria-label={`Remove mockup ${i + 1}`} onClick={() => onPatch((p) => ({ photos: p.photos.filter((x) => x.path !== ph.path) }))} className="pressable absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {Array.from({ length: pkg.uploading }, (_, i) => (
              <li key={`up-${i}`} className="flex aspect-square items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" aria-label="Uploading" />
              </li>
            ))}
          </ul>
        )}

        {!full && (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-xs transition-colors",
              dragging ? "border-brand bg-brand-soft text-brand" : "border-slate-300 bg-white text-slate-500 hover:border-brand/50",
            )}
          >
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Drag &amp; drop reference photos for requirement {no}, or click to upload
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
