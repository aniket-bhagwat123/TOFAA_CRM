"use client";
/** Delivery details, taken once with the agreement and carried into the OMS handover. All optional: what is not known yet is filled in later. */
import { Plus, Trash2, Truck } from "lucide-react";
import { OUTLINE_BTN } from "@/components/crm/quotation-sheet";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import type { AgreementDeliveryDetails } from "@/types/crm";
import type { HandoverLocation } from "@/types/orders";

type Place = HandoverLocation & { key: number };
export type DeliveryDraft = {
  expectedDelivery: string; advancePercent: string; campaignName: string; clientType: string; instructions: string; designBrief: string;
  sample: "" | "yes" | "no"; places: Place[];
};

let placeKey = 1;
export const blankDelivery = (): DeliveryDraft => ({ expectedDelivery: "", advancePercent: "", campaignName: "", clientType: "", instructions: "", designBrief: "", sample: "", places: [] });

export function fromDelivery(d?: AgreementDeliveryDetails | null): DeliveryDraft {
  if (!d) return blankDelivery();
  return {
    expectedDelivery: d.expectedDelivery ?? "", advancePercent: d.advancePercent == null ? "" : String(d.advancePercent), campaignName: d.campaignName ?? "",
    clientType: d.clientType ?? "", instructions: d.instructions ?? "", designBrief: d.designBrief ?? "",
    sample: d.sampleRequired == null ? "" : d.sampleRequired ? "yes" : "no", places: (d.deliveryLocations ?? []).map((p) => ({ ...p, key: placeKey++ })),
  };
}

const filled = (p: Place) => [p.line, p.city, p.state, p.pincode, p.contactName, p.contactPhone, p.quantity].some((v) => String(v ?? "").trim());

export function deliveryErrors(d: DeliveryDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.advancePercent && !(Number(d.advancePercent) >= 0 && Number(d.advancePercent) <= 100)) e.advance = "Between 0 and 100.";
  d.places.forEach((p) => { if (p.pincode && !/^\d{6}$/.test(p.pincode)) e[`pin-${p.key}`] = "Enter 6 digits."; });
  return e;
}

export function deliveryPayload(d: DeliveryDraft) {
  return {
    expectedDelivery: d.expectedDelivery || null, advancePercent: d.advancePercent === "" ? null : Number(d.advancePercent),
    campaignName: d.campaignName.trim() || null, clientType: d.clientType.trim() || null, instructions: d.instructions.trim() || null,
    designBrief: d.designBrief.trim() || null, sampleRequired: d.sample ? d.sample === "yes" : null,
    deliveryLocations: d.places.filter(filled).map(({ key: _key, ...place }) => place),
  };
}

type Props = { value: DeliveryDraft; errors: Record<string, string>; severalPackages: boolean; onChange: (next: DeliveryDraft) => void };

export function AgreementDelivery({ value, errors, severalPackages, onChange }: Props) {
  const set = (patch: Partial<DeliveryDraft>) => onChange({ ...value, ...patch });
  const place = (key: number, patch: Partial<Place>) => set({ places: value.places.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  const digits = (v: string) => v.replace(/\D/g, "");
  return (
    <section className="space-y-3">
      <div className="border-b border-slate-100 pb-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-800"><Truck className="h-4 w-4 text-brand" aria-hidden="true" /> Delivery details for the handover</h3>
        <p className="mt-0.5 text-xs text-slate-500">These fill the OMS handover, so they are typed only once. Leave empty what is not known yet.</p>
        {severalPackages && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">The OMS handover covers one kind of kit. With several requirements, enter the total kits on the handover.</p>}
      </div>

      <div className="grid items-start gap-3 sm:grid-cols-2">
        <DatePicker label="Requested Delivery Date" value={value.expectedDelivery} onChange={(v) => set({ expectedDelivery: v })} />
        <InputField label="Bulk Advance (%)" type="number" value={value.advancePercent} error={errors.advance} onChange={(e) => set({ advancePercent: e.target.value })} />
        <InputField label="Campaign name" maxLength={200} value={value.campaignName} onChange={(e) => set({ campaignName: e.target.value })} />
        <InputField label="Client type" maxLength={200} placeholder="For example Key Account" value={value.clientType} onChange={(e) => set({ clientType: e.target.value })} />
        <SelectField label="Sample Required" placeholder="Not decided" value={value.sample} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
          onChange={(e) => set({ sample: e.target.value as DeliveryDraft["sample"] })} />
      </div>
      <TextareaField label="Delivery instructions (OMS sees this)" rows={2} maxLength={2000} value={value.instructions} onChange={(e) => set({ instructions: e.target.value })} />
      <TextareaField label="Design brief" rows={2} maxLength={5000} value={value.designBrief} onChange={(e) => set({ designBrief: e.target.value })} />

      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Delivery Locations ({value.places.length})</h4>
        <button type="button" className={OUTLINE_BTN} disabled={value.places.length >= 500} onClick={() => set({ places: [...value.places, { key: placeKey++ }] })}><Plus className="h-3.5 w-3.5" /> Add Delivery Location</button>
      </div>
      {value.places.map((p, i) => (
        <div key={p.key} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center justify-between">
            <span className="rounded-md bg-amber-100 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200">Delivery Location {i + 1}</span>
            <button type="button" aria-label={`Remove address ${i + 1}`} onClick={() => set({ places: value.places.filter((x) => x.key !== p.key) })} className="pressable flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
          </div>
          <TextareaField label="Address" rows={2} maxLength={500} value={p.line ?? ""} onChange={(e) => place(p.key, { line: e.target.value })} />
          <div className="grid items-start gap-3 sm:grid-cols-3">
            <InputField label="City" maxLength={200} value={p.city ?? ""} onChange={(e) => place(p.key, { city: e.target.value })} />
            <InputField label="State" maxLength={200} value={p.state ?? ""} onChange={(e) => place(p.key, { state: e.target.value })} />
            <InputField label="Pincode" inputMode="numeric" maxLength={6} value={p.pincode ?? ""} error={errors[`pin-${p.key}`]} onChange={(e) => place(p.key, { pincode: digits(e.target.value) })} />
            <InputField label="Contact name" maxLength={200} value={p.contactName ?? ""} onChange={(e) => place(p.key, { contactName: e.target.value })} />
            <InputField label="Contact phone" maxLength={25} value={p.contactPhone ?? ""} onChange={(e) => place(p.key, { contactPhone: e.target.value })} />
            <InputField label="Kits (optional)" inputMode="numeric" value={p.quantity ?? ""} onChange={(e) => place(p.key, { quantity: Number(digits(e.target.value)) || null })} />
          </div>
        </div>
      ))}
    </section>
  );
}
