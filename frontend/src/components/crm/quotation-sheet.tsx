"use client";
import { FileText, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { inr, quoteTotals } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { DealData, Quotation, QuotationTemplate } from "@/types/crm";
import type { LeadTarget } from "./types";

// Sr. | Description | Qty | Price | Amount (hidden on phones) | remove
const ITEM_GRID = "grid grid-cols-[2rem_minmax(0,1fr)_4.25rem_5.75rem_2rem] items-center gap-2 px-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_5.5rem_7.5rem_7rem_2rem]";
// Inputs inside the table are compact, so the rows read as a table and not a stack of forms.
const CELL = "h-9 rounded-lg px-2.5 py-1.5 sm:text-sm";

type Row = { description: string; quantity: string; unitPrice: string };
const blank = (): Row => ({ description: "", quantity: "1", unitPrice: "" });

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void; onCreated: (q: Quotation) => void };

/** Build a quotation from line items. Creating a new one after a version exists starts from that version (a revision). */
export function QuotationSheet({ target, onClose, onDone, onCreated }: Props) {
  const deal = useApi<DealData>(target ? `/leads/${target.leadId}/deal` : null);
  const templates = useApi<QuotationTemplate[]>(target ? "/quotation-templates" : null);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [discount, setDiscount] = useState("");
  const [validDays, setValidDays] = useState("15");
  const [templateId, setTemplateId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const latest = deal.data?.quotations[0];
  const limit = deal.data?.discountLimit ?? 0;

  // A revision starts from the latest version.
  useEffect(() => {
    if (!target || !latest) return;
    setRows(latest.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: String(i.unitPrice) })));
    setDiscount(latest.discountPct ? String(latest.discountPct) : "");
    setValidDays(String(latest.validDays));
    setNotes(latest.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, !!target]);

  useEffect(() => {
    if (templates.data && !templateId) setTemplateId(templates.data.find((t) => t.isDefault)?.id ?? templates.data[0]?.id ?? "");
  }, [templates.data, templateId]);

  useEffect(() => {
    if (target) return;
    setRows([blank()]); setDiscount(""); setValidDays("15"); setNotes(""); setErrors({});
  }, [target]);

  const totals = quoteTotals(rows, discount);
  const pct = Number(discount) || 0;
  const over = pct > limit;
  const setRow = (i: number, patch: Partial<Row>) => { setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x))); setErrors((e) => ({ ...e, items: "" })); };

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    const filled = rows.filter((r) => r.description.trim() || r.unitPrice);
    if (!filled.length) e.items = "Add at least one item";
    else if (filled.some((r) => !r.description.trim())) e.items = "Every item needs a description";
    else if (filled.some((r) => !(Number(r.quantity) > 0))) e.items = "Quantity must be greater than 0";
    else if (filled.some((r) => r.unitPrice === "" || Number(r.unitPrice) < 0)) e.items = "Every item needs a price";
    else if (totals.total <= 0) e.items = "The total must be greater than 0";
    if (pct > 100) e.discountPct = "Discount cannot be more than 100%";
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const res = await apiClient.post<Quotation>(`/leads/${target.leadId}/quotations`, {
        templateId: templateId || null,
        items: filled.map((r) => ({ description: r.description.trim(), quantity: Number(r.quantity), unitPrice: Number(r.unitPrice) })),
        discountPct: pct,
        validDays: Number(validDays) || 15,
        notes: notes.trim() || null,
      });
      const q = res.data;
      if (q.status === "pending_approval") toast.info("Saved. The discount is above your limit, so your manager has to approve it before you can send.");
      else toast.success(`Quotation v${q.version} ready`);
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

        {/* items: a boxed table with serial numbers, like the printed quotation */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-slate-700">Items<span className="ml-0.5 font-semibold text-red-600" aria-hidden="true">*</span></span>
          <div className={cn("overflow-hidden rounded-xl border bg-white", errors.items ? "border-red-300" : "border-slate-200")}>
            <div className={cn(ITEM_GRID, "border-b border-slate-200 bg-slate-50 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500")}>
              <span className="text-center">Sr.</span>
              <span>Description</span>
              <span>Qty</span>
              <span>Price (₹)</span>
              <span className="hidden text-right sm:block">Amount</span>
              <span className="sr-only">Remove</span>
            </div>
            <ol className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <li key={i} className={cn(ITEM_GRID, "py-2")}>
                  <span className="flex h-6 w-6 items-center justify-center justify-self-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                  <InputField hideLabel label={`Item ${i + 1} description`} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} className={CELL} />
                  <InputField hideLabel label={`Item ${i + 1} quantity`} type="number" integer value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className={cn(CELL, "text-right")} />
                  <InputField hideLabel label={`Item ${i + 1} unit price`} type="number" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: e.target.value })} className={cn(CELL, "text-right")} />
                  <span className="hidden truncate text-right text-sm font-semibold tabular-nums text-slate-800 sm:block">{inr((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0))}</span>
                  <button type="button" aria-label={`Remove item ${i + 1}`} title="Remove item" disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, n) => n !== i))} className="pressable flex h-8 w-8 items-center justify-center justify-self-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ol>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-3 py-2">
              <button type="button" onClick={() => setRows((r) => [...r, blank()])} className="pressable inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-brand hover:bg-brand-soft">
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
              <span className="text-[13px] text-slate-500">
                {rows.length} {rows.length === 1 ? "item" : "items"} · <span className="font-semibold tabular-nums text-slate-800">{inr(totals.subtotal)}</span>
              </span>
            </div>
          </div>
          {errors.items && <p role="alert" className="text-xs font-medium text-red-600">{errors.items}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <InputField label="Discount (%)" type="number" value={discount} onChange={(e) => { setDiscount(e.target.value); setErrors((x) => ({ ...x, discountPct: "" })); }} error={errors.discountPct} />
            <p className={cn("mt-1 text-xs", over ? "font-medium text-amber-600" : "text-slate-400")}>
              {over ? `Above your ${limit}% limit: your manager will approve it before you can send.` : `Your limit is ${limit}%.`}
            </p>
          </div>
          <InputField label="Valid for (days)" type="number" integer value={validDays} onChange={(e) => setValidDays(e.target.value)} />
        </div>
        <TextareaField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes for the client" />

        <div className="space-y-1 rounded-2xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{inr(totals.subtotal)}</span></div>
          {pct > 0 && <div className="flex justify-between text-slate-500"><span>Discount ({pct}%)</span><span>− {inr(totals.discount)}</span></div>}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900"><span>Total</span><span>{inr(totals.total)}</span></div>
        </div>

        <Button onClick={save} loading={busy} className="w-full">{over ? "Save and ask for approval" : "Save quotation"}</Button>
      </div>
    </Sheet>
  );
}
