"use client";
/** What OMS needs for an order: kits, items, delivery places, design and sample. No money. */
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { MAX_PACKAGE_PHOTOS, MAX_PHOTO_BYTES, PHOTO_TYPES } from "@/components/crm/quotation-sheet";
import { blankHandoverItem, HandoverKit } from "@/components/orders/handover-kit";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { FileButton } from "@/components/ui/file-button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Handover, HandoverFile, HandoverForm as Values, HandoverItem, HandoverLocation } from "@/types/orders";

const text = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const digits = (v: string) => v.replace(/\D/g, "");
const whole = (v: string) => (v ? Number(v) : null);

const FILE_TYPES = ".pdf,.docx,.jpg,.jpeg,.png,.webp";
const empty = (v: string | null | undefined) => !v?.trim();

/** Every mandatory field that is missing or wrong, by field. The server checks the same again before approval. */
function check(form: Values, advance: string): Record<string, string> {
  const found: Record<string, string> = {};
  if (!form.totalKits) found.totalKits = "Enter the Kit Quantity.";
  if (!form.expectedDelivery) found.deadline = "Choose the Requested Delivery Date.";
  if (advance && !(Number(advance) >= 0 && Number(advance) <= 100)) found.advance = "Between 0 and 100.";
  form.items.forEach((x, i) => {
    if (empty(x.name)) found[`name${i}`] = "Enter the Element name.";
    if (!x.quantityPerKit) found[`perKit${i}`] = "At least 1.";
  });
  form.deliveryLocations.forEach((p, i) => {
    if (empty(p.line)) found[`line${i}`] = "Enter the address.";
    if (empty(p.city)) found[`city${i}`] = "Enter the city.";
    if (empty(p.state)) found[`state${i}`] = "Enter the state.";
    if (!/^\d{6}$/.test(p.pincode?.trim() ?? "")) found[`pin${i}`] = "Enter 6 digits.";
    if (empty(p.contactName)) found[`contact${i}`] = "Enter the contact name.";
    if (empty(p.contactPhone)) found[`phone${i}`] = "Enter the contact phone.";
  });
  const given = form.deliveryLocations.reduce((sum, p) => sum + (p.quantity ?? 0), 0);
  const open = form.deliveryLocations.filter((p) => !p.quantity).length;
  if (form.totalKits && (open ? given + open > form.totalKits : given !== form.totalKits)) {
    found.quantities = `Location kits ${open ? "leave too few for the other locations" : `add up to ${given}`}; there are ${form.totalKits} kits.`;
  }
  const s = form.sample;
  if (s.required == null) found.sample = "Choose Yes or No.";
  if (s.required && (!empty(s.approverName) || s.approvedOn || s.evidence)) {
    if (empty(s.approverName)) found.approver = "Enter who approved it.";
    if (!s.approvedOn) found.approvedOn = "Choose the approval date.";
    if (!s.evidence) found.evidence = "Add the evidence file.";
  }
  return found;
}

type Props = { handover: Handover; busy: boolean; onCancel: () => void; onSubmit: (values: Values) => void };

export function HandoverForm({ handover, busy, onCancel, onSubmit }: Props) {
  // A first item and location are shown ready to fill: at least one of each is mandatory.
  const [form, setForm] = useState<Values>(() => ({
    ...handover.form,
    items: handover.form.items.length ? handover.form.items : [blankHandoverItem()],
    deliveryLocations: handover.form.deliveryLocations.length ? handover.form.deliveryLocations : [{}],
  }));
  const [advance, setAdvance] = useState(text(handover.form.advancePercent));
  const [uploading, setUploading] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = tried ? check(form, advance) : {}; // shown after the first try, cleared as fixed
  const set = (patch: Partial<Values>) => setForm((f) => ({ ...f, ...patch }));
  const item = (ref: string, change: (x: HandoverItem) => Partial<HandoverItem>) => setForm((f) => ({ ...f, items: f.items.map((x) => (x.itemRef === ref ? { ...x, ...change(x) } : x)) }));
  const [urls, setUrls] = useState<Record<string, string>>(() => Object.fromEntries(handover.fileUrls.map((f) => [f.path, f.url])));
  const [photos, setPhotos] = useState<Record<string, number>>({}); // item reference -> photos being uploaded
  const place = (i: number, patch: Partial<HandoverLocation>) => setForm((f) => ({ ...f, deliveryLocations: f.deliveryLocations.map((x, n) => (n === i ? { ...x, ...patch } : x)) }));
  const shipped = new Set(handover.oms.shipments.map((s) => s.locationRef));

  async function send(file: File) {
    const body = new FormData();
    body.append("file", file);
    const res = await apiClient.post<HandoverFile & { url?: string }>(`/orders/by-id/${handover.orderId}/handover/files`, body, { timeout: 60000 });
    if (res.data.url) setUrls((all) => ({ ...all, [res.data.path]: res.data.url! }));
    return { path: res.data.path, name: res.data.name };
  }

  async function upload(key: string, files: File[], done: (f: HandoverFile) => void) {
    setUploading(key);
    for (const file of files) {
      try { done(await send(file)); } catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`, { duration: 8000 }); }
    }
    setUploading(null);
  }

  async function addPhotos(ref: string, files: File[]) {
    const room = MAX_PACKAGE_PHOTOS - (form.items.find((x) => x.itemRef === ref)?.photos.length ?? 0) - (photos[ref] ?? 0);
    const good = files.filter((f) => {
      if (!PHOTO_TYPES.includes(f.type)) { toast.error(`${f.name}: use a JPEG, PNG or WebP image`); return false; }
      if (f.size > MAX_PHOTO_BYTES) { toast.error(`${f.name}: each photo must be 5 MB or smaller`); return false; }
      return true;
    });
    if (good.length > room) toast.error(`Up to ${MAX_PACKAGE_PHOTOS} photos per item`);
    const batch = good.slice(0, Math.max(room, 0));
    const count = (n: number) => setPhotos((all) => ({ ...all, [ref]: (all[ref] ?? 0) + n }));
    count(batch.length);
    await Promise.all(batch.map(async (file) => {
      try {
        const saved = await send(file);
        item(ref, (x) => ({ photos: [...x.photos, saved.path] }));
      } catch (e) {
        toast.error(`${file.name}: ${errorMessage(e)}`, { duration: 8000 });
      } finally { count(-1); }
    }));
  }

  const pick = (key: string, label: string, done: (f: HandoverFile) => void, many = true): ReactNode => (
    <FileButton accept={FILE_TYPES} multiple={many} busy={uploading === key} disabled={!!uploading} onFiles={(files) => void upload(key, files, done)}>{label}</FileButton>
  );
  const chip = (f: HandoverFile, remove: () => void) => (
    <li key={f.path} className="flex items-center gap-2 text-sm text-slate-700">
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      {urls[f.path] ? <a href={urls[f.path]} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-brand hover:underline">{f.name}</a> : <span className="min-w-0 truncate">{f.name}</span>}
      <button type="button" aria-label={`Remove ${f.name}`} onClick={remove} className="rounded p-1 text-slate-500 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
    </li>
  );
  const files = (key: "referenceFiles" | "logoFiles", label: string) => (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <ul className="space-y-1">{form[key].map((f) => chip(f, () => set({ [key]: form[key].filter((x) => x.path !== f.path) })))}</ul>
      {pick(key, "Upload files", (f) => setForm((all) => ({ ...all, [key]: [...all[key], f] })))}
    </div>
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    const missing = Object.keys(check(form, advance)).length;
    if (missing) { toast.error(`Fill in the mandatory fields (${missing} to fix).`); return; }
    onSubmit({ ...form, advancePercent: advance === "" ? null : Number(advance) });
  }

  const sample = form.sample;
  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <HandoverKit items={form.items} totalKits={form.totalKits} errors={errors} urls={urls} uploading={photos}
        onKits={(totalKits) => set({ totalKits })} onItem={item} onPhotos={(ref, files) => void addPhotos(ref, files)}
        onAdd={() => setForm((f) => ({ ...f, items: [...f.items, blankHandoverItem()] }))}
        onRemove={(ref) => setForm((f) => ({ ...f, items: f.items.filter((x) => x.itemRef !== ref) }))} />

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Deal details</h2>
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <DatePicker label="Requested Delivery Date" required error={errors.deadline} value={text(form.expectedDelivery)} onChange={(v) => set({ expectedDelivery: v || null })} />
          <InputField label="Bulk Advance (%) (optional)" inputMode="decimal" value={advance} error={errors.advance} onChange={(e) => setAdvance(e.target.value.replace(/[^\d.]/g, ""))} />
          <InputField label="Campaign name" maxLength={200} value={text(form.campaignName)} onChange={(e) => set({ campaignName: e.target.value })} />
          <InputField label="Client type" maxLength={200} placeholder="For example Key Account" value={text(form.clientType)} onChange={(e) => set({ clientType: e.target.value })} />
        </div>
        <TextareaField label="Client instructions (OMS sees this)" maxLength={2000} value={text(form.instructions)} onChange={(e) => set({ instructions: e.target.value })} />
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Delivery Locations</h2>
        {form.deliveryLocations.map((p, i) => (
          <div key={p.locationRef ?? `new-${i}`} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <TextareaField label="Address" required error={errors[`line${i}`]} rows={2} maxLength={500} value={text(p.line)} onChange={(e) => place(i, { line: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <InputField label="City" required error={errors[`city${i}`]} maxLength={200} value={text(p.city)} onChange={(e) => place(i, { city: e.target.value })} />
              <InputField label="State" required error={errors[`state${i}`]} maxLength={200} value={text(p.state)} onChange={(e) => place(i, { state: e.target.value })} />
              <InputField label="Pincode" required inputMode="numeric" maxLength={6} value={text(p.pincode)} error={errors[`pin${i}`]} onChange={(e) => place(i, { pincode: digits(e.target.value) })} />
              <InputField label="Contact name" required error={errors[`contact${i}`]} maxLength={200} value={text(p.contactName)} onChange={(e) => place(i, { contactName: e.target.value })} />
              <InputField label="Contact phone" required error={errors[`phone${i}`]} maxLength={25} value={text(p.contactPhone)} onChange={(e) => place(i, { contactPhone: e.target.value })} />
              <InputField label="Kits (optional)" inputMode="numeric" value={text(p.quantity)} onChange={(e) => place(i, { quantity: whole(digits(e.target.value)) })} />
            </div>
            {form.deliveryLocations.length > 1 && !shipped.has(p.locationRef ?? "") && <button type="button" className="text-sm font-medium text-red-600 hover:underline" onClick={() => set({ deliveryLocations: form.deliveryLocations.filter((_, n) => n !== i) })}>Remove location</button>}
          </div>
        ))}
        {errors.quantities && <p role="alert" className="text-sm font-medium text-red-600">{errors.quantities}</p>}
        {form.deliveryLocations.length < 500 && <Button type="button" variant="secondary" onClick={() => set({ deliveryLocations: [...form.deliveryLocations, {}] })}><Plus className="h-4 w-4" />Add Delivery Location</Button>}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Design brief</h2>
        <TextareaField label="Brief" rows={4} maxLength={5000} value={text(form.designBrief)} onChange={(e) => set({ designBrief: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">{files("referenceFiles", "Reference files")}{files("logoFiles", "Logo files")}</div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Sample</h2>
        <SelectField label="Sample Required" required error={errors.sample} placeholder="Choose" value={sample.required == null ? "" : sample.required ? "yes" : "no"}
          options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} onChange={(e) => set({ sample: { ...sample, required: e.target.value ? e.target.value === "yes" : null } })} />
        {sample.required && (
          <>
            <p className="text-sm text-slate-500">Once the client approves the sample, fill in all three. Leave them empty until then.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <InputField label="Approved by" error={errors.approver} maxLength={200} value={text(sample.approverName)} onChange={(e) => set({ sample: { ...sample, approverName: e.target.value } })} />
              <DatePicker label="Approved on" error={errors.approvedOn} value={text(sample.approvedOn)} onChange={(v) => set({ sample: { ...sample, approvedOn: v || null } })} />
            </div>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-slate-700">Evidence</span>
              {sample.evidence && <ul>{chip(sample.evidence, () => set({ sample: { ...sample, evidence: null } }))}</ul>}
              {pick("evidence", sample.evidence ? "Replace file" : "Upload file", (f) => setForm((all) => ({ ...all, sample: { ...all.sample, evidence: f } })), false)}
              {errors.evidence && <p role="alert" className="text-xs font-medium text-red-600">{errors.evidence}</p>}
            </div>
          </>
        )}
      </Card>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy} disabled={!!uploading || Object.values(photos).some((n) => n > 0)}>Save handover</Button>
      </div>
    </form>
  );
}
