"use client";
/** The kit, laid out like a requirement package: how many kits, the items in one kit, and each item's photos. No money. */
import { Boxes, ImageIcon, Loader2, Plus, Trash2, X } from "lucide-react";
import { useState, type DragEvent } from "react";
import { MAX_PACKAGE_PHOTOS, MAX_PHOTO_BYTES, OUTLINE_BTN, PHOTO_TYPES } from "@/components/crm/quotation-sheet";
import { FileButton } from "@/components/ui/file-button";
import { InputField } from "@/components/ui/input-field";
import { cn } from "@/lib/utils";
import type { HandoverItem } from "@/types/orders";

const MAX_ITEMS = 200;
const CELL = "h-9 rounded-lg px-2.5 py-1.5 sm:text-sm";
const SMALL_LABEL = "mb-1 block text-[12px] font-semibold uppercase tracking-wide text-slate-500";
const digits = (v: string) => v.replace(/\D/g, "");

/** A new item gets its reference here, so photos being uploaded always find their item again. */
export const blankHandoverItem = (): HandoverItem => ({
  itemRef: `IT-${Math.random().toString(36).slice(2, 12)}`, name: "", description: "", quantityPerKit: 1, isPackaging: false, photos: [],
});

type Props = {
  items: HandoverItem[];
  totalKits?: number | null;
  errors: Record<string, string>;
  urls: Record<string, string>; // storage path -> link, for previews
  uploading: Record<string, number>; // item reference -> photos on the way
  onKits: (kits: number | null) => void;
  onItem: (ref: string, change: (item: HandoverItem) => Partial<HandoverItem>) => void;
  onAdd: () => void;
  onRemove: (ref: string) => void;
  onPhotos: (ref: string, files: File[]) => void;
};

export function HandoverKit({ items, totalKits, errors, urls, uploading, onKits, onItem, onAdd, onRemove, onPhotos }: Props) {
  const perKit = items.reduce((sum, x) => sum + (x.quantityPerKit ?? 0), 0);
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="shrink-0 rounded-md bg-amber-100 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">Kit</span>
        <p className="text-sm text-slate-500">One handover describes one kind of kit.</p>
      </div>

      <div className="grid items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
        <div>
          <span className={SMALL_LABEL} aria-hidden="true">Kit Quantity <span className="text-red-600">*</span></span>
          <InputField hideLabel label="Kit Quantity" placeholder="0" inputMode="numeric" error={errors.totalKits} value={totalKits ?? ""} className={CELL}
            onChange={(e) => onKits(Number(digits(e.target.value)) || null)} />
        </div>
        <div>
          <span className={SMALL_LABEL}>Elements per Kit</span>
          <p className="flex h-9 items-center text-sm font-semibold tabular-nums text-slate-900">{items.length}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-emerald-700">Total pieces</span>
          <span className="mt-0.5 block truncate text-lg font-bold tabular-nums text-emerald-700">{(perKit * (totalKits ?? 0)).toLocaleString("en-IN")}</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
            <Boxes className="h-4 w-4 text-slate-500" aria-hidden="true" /> Elements in one kit ({items.length}) <span className="text-red-600" aria-hidden="true">*</span>
          </h4>
          <button type="button" className={OUTLINE_BTN} disabled={items.length >= MAX_ITEMS} onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Add Element</button>
        </div>
        <ol className="space-y-2">
          {items.map((item, i) => (
            <ItemRow key={item.itemRef} no={i + 1} item={item} nameError={errors[`name${i}`]} qtyError={errors[`perKit${i}`]} urls={urls}
              uploading={uploading[item.itemRef!] ?? 0} canRemove={items.length > 1}
              onChange={(change) => onItem(item.itemRef!, change)} onRemove={() => onRemove(item.itemRef!)} onPhotos={(files) => onPhotos(item.itemRef!, files)} />
          ))}
        </ol>
      </div>
    </div>
  );
}

type RowProps = {
  no: number; item: HandoverItem; nameError?: string; qtyError?: string; urls: Record<string, string>; uploading: number; canRemove: boolean;
  onChange: (change: (item: HandoverItem) => Partial<HandoverItem>) => void; onRemove: () => void; onPhotos: (files: File[]) => void;
};

function ItemRow({ no, item, nameError, qtyError, urls, uploading, canRemove, onChange, onRemove, onPhotos }: RowProps) {
  const [dragging, setDragging] = useState(false);
  const full = item.photos.length + uploading >= MAX_PACKAGE_PHOTOS;
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!full) onPhotos(Array.from(e.dataTransfer.files));
  };
  return (
    <li onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}
      className={cn("space-y-2 rounded-xl border bg-white p-2.5", nameError || qtyError ? "border-red-300" : dragging ? "border-brand bg-brand-soft" : "border-slate-200")}>
      <div className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
        <span className="flex h-9 w-5 shrink-0 items-center justify-center text-xs font-medium text-slate-400">{no}</span>
        <div className="min-w-0 flex-1 sm:w-[32%] sm:flex-none">
          <InputField hideLabel label={`Item ${no} name`} placeholder="Element *" maxLength={200} error={nameError} value={item.name ?? ""} className={CELL}
            onChange={(e) => onChange(() => ({ name: e.target.value }))} />
        </div>
        <div className="order-last w-full pl-7 sm:order-none sm:w-auto sm:flex-1 sm:pl-0">
          <InputField hideLabel label={`Item ${no} description`} placeholder="Description or specification" maxLength={2000} value={item.description ?? ""} className={CELL}
            onChange={(e) => onChange(() => ({ description: e.target.value }))} />
        </div>
        <div className="w-20 shrink-0">
          <InputField hideLabel label={`Item ${no} quantity per kit`} title="Quantity per kit" placeholder="Per kit *" inputMode="numeric" error={qtyError} value={item.quantityPerKit ?? ""} className={CELL}
            onChange={(e) => onChange(() => ({ quantityPerKit: Number(digits(e.target.value)) || null }))} />
        </div>
        <button type="button" aria-label={`Remove item ${no}`} title="Remove item" disabled={!canRemove} onClick={onRemove}
          className="pressable flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
        <label className="flex items-center gap-1.5 text-xs text-slate-700">
          <input type="checkbox" checked={item.isPackaging} onChange={(e) => onChange(() => ({ isPackaging: e.target.checked }))} />Packaging (box, sleeve, insert)
        </label>
        <div className="w-44">
          <InputField hideLabel label={`Item ${no} product ID`} placeholder="Product ID (optional)" maxLength={200} value={item.productId ?? ""} className={CELL}
            onChange={(e) => onChange(() => ({ productId: e.target.value }))} />
        </div>
        <FileButton className="ml-auto" accept={PHOTO_TYPES.join(",")} multiple disabled={full} onFiles={onPhotos}>Upload photos</FileButton>
      </div>

      {(item.photos.length > 0 || uploading > 0) ? (
        <ul className="grid grid-cols-4 gap-2 pl-7 sm:grid-cols-8">
          {item.photos.map((path, n) => (
            <li key={path} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
              {urls[path] ? (
                <a href={urls[path]} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage link */}
                  <img src={urls[path]} alt={`Item ${no} photo ${n + 1}`} className="h-full w-full object-cover" />
                </a>
              ) : <span className="flex h-full w-full items-center justify-center text-slate-300"><ImageIcon className="h-5 w-5" /></span>}
              <button type="button" aria-label={`Remove photo ${n + 1} of item ${no}`} onClick={() => onChange((x) => ({ photos: x.photos.filter((p) => p !== path) }))}
                className="pressable absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/60 text-white hover:bg-red-600">
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {Array.from({ length: uploading }, (_, n) => (
            <li key={`up-${n}`} className="flex aspect-square items-center justify-center rounded-lg border border-slate-200 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" /></li>
          ))}
        </ul>
      ) : <p className="pl-7 text-xs text-slate-400">No photos. Upload, or drag images onto this item ({MAX_PACKAGE_PHOTOS} at most, {MAX_PHOTO_BYTES / 1024 / 1024} MB each).</p>}
    </li>
  );
}
