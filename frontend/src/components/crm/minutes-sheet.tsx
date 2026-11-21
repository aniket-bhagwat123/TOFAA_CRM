"use client";
import { NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { DocumentPicker } from "@/components/ui/document-picker";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso, todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { LeadDetail } from "@/types/crm";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";
import { VoiceTextarea } from "./voice-textarea";

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/**
 * After a meeting: the minutes and what the client needs. Saving this is the action that moves the lead to
 * Requirement Received. Nothing else to tick.
 */
export function MinutesSheet({ target, onClose, onDone }: Props) {
  const detail = useApi<LeadDetail>(target ? `/leads/${target.leadId}` : null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [occasion, setOccasion] = useState("");
  const [quantity, setQuantity] = useState("");
  const [budget, setBudget] = useState("");
  const [delivery, setDelivery] = useState("");
  const [follow, setFollow] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Start from what is already known about this lead.
  useEffect(() => {
    const req = detail.data?.lead.requirement;
    if (!req) return;
    setOccasion((o) => o || String(req.occasion ?? ""));
    setQuantity((q) => q || (req.quantity ? String(req.quantity) : ""));
    setBudget((b) => b || (req.budget ? String(req.budget) : ""));
    setDelivery((d) => d || String(req.deliveryDate ?? ""));
  }, [detail.data]);

  useEffect(() => {
    if (target) return;
    setNote(""); setFile(null); setOccasion(""); setQuantity(""); setBudget(""); setDelivery(""); setFollow(nextBusinessDayIso()); setErrors({});
  }, [target]);

  const clear = (k: string) => setErrors((e) => ({ ...e, [k]: "" }));

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!note.trim() && !file) e.note = "Type the minutes or attach a file";
    if (!occasion.trim()) e.occasion = "Occasion is required";
    if (!(Number(quantity) > 0)) e.quantity = quantity ? "Quantity must be greater than 0" : "Quantity is required";
    if (!(Number(budget) > 0)) e.budget = budget ? "Budget must be greater than 0" : "Budget is required";
    if (!delivery) e.deliveryDate = "Delivery date is required";
    if (!follow) e.nextFollowUp = "Pick the next follow-up date";
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const form = new FormData();
      form.append("occasion", occasion.trim());
      form.append("quantity", quantity);
      form.append("budget", budget);
      form.append("deliveryDate", delivery);
      form.append("nextFollowUp", follow);
      if (note.trim()) form.append("note", note.trim());
      if (file) form.append("file", file);
      await apiClient.post(`/leads/${target.leadId}/minutes`, form, { timeout: 60000 });
      toast.success("Minutes saved. Moved to Requirement Received.");
      onClose();
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!target} title="Minutes of meeting" subtitle={target?.name} icon={NotebookPen} tone="indigo" onClose={onClose} width="lg">
      <div className="space-y-4">
        <VoiceTextarea label="Minutes" value={note} onChange={(v) => { setNote(v); clear("note"); }} rows={4} placeholder="Write the minutes" />
        {errors.note && <p role="alert" className="-mt-2 text-xs font-medium text-red-600">{errors.note}</p>}
        <DocumentPicker label="Or attach the minutes (optional if typed)" file={file} onChange={(f) => { setFile(f); clear("note"); }} />

        <div className="border-t border-slate-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">What the client needs</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Occasion" required value={occasion} onChange={(e) => { setOccasion(e.target.value); clear("occasion"); }} error={errors.occasion} />
            <DatePicker label="Delivery date" required min={todayIso()} value={delivery} onChange={(d) => { setDelivery(d); clear("deliveryDate"); }} error={errors.deliveryDate} />
            <InputField label="Quantity" type="number" integer required value={quantity} onChange={(e) => { setQuantity(e.target.value); clear("quantity"); }} error={errors.quantity} />
            <InputField label="Budget (₹)" type="number" required value={budget} onChange={(e) => { setBudget(e.target.value); clear("budget"); }} error={errors.budget} />
          </div>
        </div>
        <DateChips label="Next follow-up" required value={follow} onChange={(d) => { setFollow(d); clear("nextFollowUp"); }} error={errors.nextFollowUp} />
        <Button onClick={save} loading={busy} className="w-full">Save minutes</Button>
      </div>
    </Sheet>
  );
}
