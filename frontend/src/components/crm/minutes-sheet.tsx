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
    if (!note.trim()) e.note = "Summary is required";
    if (quantity && !(Number(quantity) > 0)) e.quantity = "Quantity must be greater than 0";
    if (budget && !(Number(budget) > 0)) e.budget = "Budget must be greater than 0";
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    try {
      const form = new FormData();
      form.append("note", note.trim());
      if (occasion.trim()) form.append("occasion", occasion.trim());
      if (quantity) form.append("quantity", quantity);
      if (budget) form.append("budget", budget);
      if (delivery) form.append("deliveryDate", delivery);
      if (follow) form.append("nextFollowUp", follow);
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
        <div>
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField label="Occasion" value={occasion} onChange={(e) => { setOccasion(e.target.value); clear("occasion"); }} error={errors.occasion} />
            <DatePicker label="Delivery date" min={todayIso()} value={delivery} onChange={(d) => { setDelivery(d); clear("deliveryDate"); }} error={errors.deliveryDate} />
            <InputField label="Quantity" type="number" integer value={quantity} onChange={(e) => { setQuantity(e.target.value); clear("quantity"); }} error={errors.quantity} />
            <InputField label="Budget (₹)" type="number" value={budget} onChange={(e) => { setBudget(e.target.value); clear("budget"); }} error={errors.budget} />
          </div>
        </div>
        <DateChips label="Next follow-up" value={follow} onChange={(d) => { setFollow(d); clear("nextFollowUp"); }} error={errors.nextFollowUp} />

        {/* the minutes themselves, at the end of the form */}
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <VoiceTextarea label="Summary" required value={note} onChange={(v) => { setNote(v); clear("note"); }} rows={4} placeholder="Write the summary" />
          {errors.note && <p role="alert" className="-mt-2 text-xs font-medium text-red-600">{errors.note}</p>}
          <DocumentPicker label="Attach the minutes (optional)" file={file} onChange={setFile} />
        </div>
        <Button onClick={save} loading={busy} className="w-full">Save minutes</Button>
      </div>
    </Sheet>
  );
}
