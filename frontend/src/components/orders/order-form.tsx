"use client";
/** Items, money, delivery and shipment of an order: used to create one and to change one. The server recomputes totals. */
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { inr } from "@/lib/money";
import type { OrderDetail, OrderItemDetail } from "@/types/orders";

type Row = { name: string; quantity: string; unitPrice: string; contents: string };
const emptyRow = (): Row => ({ name: "", quantity: "1", unitPrice: "", contents: "" });
const toContents = (details: OrderItemDetail[]) => details.map((d) => (d.description ? `${d.name}: ${d.description}` : d.name)).join("\n");
const toDetails = (text: string): OrderItemDetail[] => text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
  const at = line.indexOf(":");
  return at > 0 ? { name: line.slice(0, at).trim(), description: line.slice(at + 1).trim() || null } : { name: line, description: null };
});
const GST_RATES = [0, 5, 12, 18, 28];
const TEXT = ["deliveryAddress", "receiverName", "receiverPhone", "instructions", "billingName", "billingGstin", "notes", "courier", "trackingNumber", "trackingUrl", "omsReference"] as const;

type Props = {
  order?: OrderDetail; // absent when creating
  clients?: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
};

export function OrderForm({ order, clients, busy, onCancel, onSubmit }: Props) {
  const creating = !order;
  const itemsOpen = creating || order.canEditItems;
  const deliveryOpen = creating || order.canEditDelivery;
  const [companyId, setCompanyId] = useState("");
  const [rows, setRows] = useState<Row[]>(() => order?.items.length
    ? order.items.map((i) => ({ name: i.name, quantity: String(i.quantity), unitPrice: String(i.unitPrice), contents: toContents(i.details) }))
    : [emptyRow()]);
  const [transport, setTransport] = useState(String(order?.transportation ?? 0));
  const [gstRate, setGstRate] = useState(String(order?.gstRate ?? 18));
  const [delivery, setDelivery] = useState(order?.expectedDelivery ?? "");
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(TEXT.map((k) => [k, (order?.[k] as string | null | undefined) ?? ""])));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = (index: number, patch: Partial<Row>) => { setRows((all) => all.map((r, i) => (i === index ? { ...r, ...patch } : r))); setErrors({}); };
  const subtotal = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
  const gst = ((subtotal + (Number(transport) || 0)) * Number(gstRate)) / 100;

  function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (creating && !companyId) found.companyId = "Choose the client.";
    if (itemsOpen) {
      rows.forEach((r, i) => {
        if (!r.name.trim()) found[`name${i}`] = "Enter the item.";
        if (!(Number(r.quantity) > 0)) found[`qty${i}`] = "More than 0.";
        if (r.unitPrice.trim() === "" || !(Number(r.unitPrice) >= 0)) found[`price${i}`] = "Enter the rate.";
      });
      if (!(Number(transport) >= 0)) found.transport = "Enter 0 or more.";
    }
    if (text.billingGstin.trim() && !/^[A-Za-z0-9]{15}$/.test(text.billingGstin.trim())) found.billingGstin = "A GSTIN has 15 letters and digits.";
    if (text.trackingUrl.trim() && !/^https?:\/\/\S+$/.test(text.trackingUrl.trim())) found.trackingUrl = "Start with http:// or https://";
    setErrors(found);
    if (Object.keys(found).length) return;
    const money = { items: rows.map((r) => ({ name: r.name.trim(), quantity: r.quantity, unitPrice: r.unitPrice, details: toDetails(r.contents) })), transportation: transport || "0", gstRate: Number(gstRate) };
    const values: Record<string, unknown> = { ...(itemsOpen ? money : {}), notes: text.notes };
    if (deliveryOpen) Object.assign(values, { expectedDelivery: delivery || null, ...Object.fromEntries(TEXT.slice(0, 6).map((k) => [k, text[k]])) });
    if (!creating) Object.assign(values, { courier: text.courier, trackingNumber: text.trackingNumber, trackingUrl: text.trackingUrl, omsReference: text.omsReference });
    onSubmit(creating ? { companyId, ...values } : values);
  }

  const field = (key: (typeof TEXT)[number], label: string, extra: { disabled?: boolean; maxLength?: number; placeholder?: string } = {}) => (
    <InputField label={label} value={text[key]} error={errors[key]} maxLength={200} {...extra} onChange={(e) => { setText((t) => ({ ...t, [key]: e.target.value })); setErrors({}); }} />
  );
  const area = (key: (typeof TEXT)[number], label: string, disabled?: boolean) => (
    <TextareaField label={label} rows={3} maxLength={2000} value={text[key]} disabled={disabled} onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))} />
  );

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {creating && (
        <Card className="p-5">
          <SelectField label="Client" required value={companyId} error={errors.companyId} placeholder={clients ? "Choose a client" : "Loading…"}
            options={(clients ?? []).map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => { setCompanyId(e.target.value); setErrors({}); }} />
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Items</h2>
        {!itemsOpen && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-900">Items and prices are locked while this deal is being fulfilled.</p>}
        {rows.map((r, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem_8rem_auto] sm:items-start">
              <InputField label="Item" required maxLength={200} disabled={!itemsOpen} value={r.name} error={errors[`name${i}`]} onChange={(e) => change(i, { name: e.target.value })} />
              <InputField label="Quantity" required inputMode="decimal" disabled={!itemsOpen} value={r.quantity} error={errors[`qty${i}`]} onChange={(e) => change(i, { quantity: e.target.value.replace(/[^\d.]/g, "") })} />
              <InputField label="Rate (₹)" required inputMode="decimal" disabled={!itemsOpen} value={r.unitPrice} error={errors[`price${i}`]} onChange={(e) => change(i, { unitPrice: e.target.value.replace(/[^\d.]/g, "") })} />
              <div><span className="block text-sm font-medium text-slate-700">Amount</span><p className="mt-2.5 font-semibold tabular-nums text-slate-900">{inr((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), true)}</p></div>
              {itemsOpen && rows.length > 1 && <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((all) => all.filter((_, x) => x !== i))} className="pressable mt-7 rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
            </div>
            <TextareaField label="What is inside (one per line, optional)" rows={2} disabled={!itemsOpen} value={r.contents} onChange={(e) => change(i, { contents: e.target.value })} />
          </div>
        ))}
        {itemsOpen && rows.length < 100 && <Button type="button" variant="secondary" onClick={() => setRows((all) => [...all, emptyRow()])}><Plus className="h-4 w-4" />Add item</Button>}
        <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField label="Transportation (₹)" inputMode="decimal" disabled={!itemsOpen} value={transport} error={errors.transport} onChange={(e) => setTransport(e.target.value.replace(/[^\d.]/g, ""))} />
            <SelectField label="GST" disabled={!itemsOpen} value={gstRate} onChange={(e) => setGstRate(e.target.value)} options={[...new Set([...GST_RATES, Number(gstRate)])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: `${r}%` }))} />
          </div>
          <dl className="space-y-1 text-sm sm:justify-self-end sm:text-right">
            <div className="flex justify-between gap-8"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{inr(subtotal, true)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-slate-500">Transportation</dt><dd className="tabular-nums">{inr(Number(transport) || 0, true)}</dd></div>
            <div className="flex justify-between gap-8"><dt className="text-slate-500">GST ({gstRate}%)</dt><dd className="tabular-nums">{inr(gst, true)}</dd></div>
            <div className="flex justify-between gap-8 text-base font-semibold text-slate-900"><dt>Total</dt><dd className="tabular-nums">{inr(subtotal + (Number(transport) || 0) + gst, true)}</dd></div>
          </dl>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">Delivery and billing</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {deliveryOpen ? <DatePicker label="Requested Delivery Date" value={delivery} onChange={setDelivery} /> : <InputField label="Requested Delivery Date" disabled value={delivery} onChange={() => undefined} />}
          {field("receiverName", "Receiver name", { disabled: !deliveryOpen })}
          {field("receiverPhone", "Receiver phone", { disabled: !deliveryOpen, maxLength: 25 })}
          {field("billingName", "Billing name", { disabled: !deliveryOpen })}
          {field("billingGstin", "Billing GSTIN", { disabled: !deliveryOpen, maxLength: 15 })}
        </div>
        {area("deliveryAddress", "Delivery address", !deliveryOpen)}
        {area("instructions", "Branding, packaging and special instructions (OMS sees this)", !deliveryOpen)}
        {area("notes", "Internal notes (not sent to OMS)")}
      </Card>

      {!creating && (
        <Card className="space-y-3 p-5">
          <h2 className="text-base font-semibold text-slate-900">Shipment</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("courier", "Courier")}
            {field("trackingNumber", "Tracking number")}
            {field("trackingUrl", "Tracking link", { maxLength: 500, placeholder: "https://" })}
            {field("omsReference", "OMS reference")}
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={busy}>{creating ? "Create deal" : "Save deal"}</Button>
      </div>
    </form>
  );
}
