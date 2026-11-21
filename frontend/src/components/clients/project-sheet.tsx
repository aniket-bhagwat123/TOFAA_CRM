"use client";
import { FolderPlus, PhoneIncoming } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { ClientContact } from "@/types/crm";
import { VoiceTextarea } from "../crm/voice-textarea";

export type ProjectMode = "new" | "inbound";
type Props = {
  clientId: string | null;
  clientName?: string;
  mode: ProjectMode;
  contacts: ClientContact[];
  occasions: string[];
  onClose: () => void;
  onDone: (projectId: string) => void;
};

/**
 * New project ("we see an opportunity") or New requirement ("the client called us"). A requirement is captured with its
 * numbers and gets a "Send the proposal" task due today, so the reply goes out fast.
 */
export function ProjectSheet({ clientId, clientName, mode, contacts, occasions, onClose, onDone }: Props) {
  const inbound = mode === "inbound";
  const [title, setTitle] = useState("");
  const [occasion, setOccasion] = useState("");
  const [contactId, setContactId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [budget, setBudget] = useState("");
  const [delivery, setDelivery] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (clientId) setContactId(contacts[0]?.id ?? "");
    else { setTitle(""); setOccasion(""); setQuantity(""); setBudget(""); setDelivery(""); setNotes(""); setErrors({}); }
  }, [clientId, contacts]);

  async function save() {
    if (!clientId) return;
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Name the project";
    if (inbound && !(Number(quantity) > 0)) e.quantity = "Quantity is required";
    if (inbound && !(Number(budget) > 0)) e.budget = "Budget is required";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>(`/clients/${clientId}/projects`, {
        title: title.trim(), occasion: occasion || null, origin: inbound ? "inbound" : "outbound", contactId: contactId || null,
        quantity: quantity ? Number(quantity) : null, budget: budget ? Number(budget) : null, deliveryDate: delivery || null, notes: notes.trim() || null,
      });
      toast.success(inbound ? "Requirement saved. Send the proposal today." : "Project created");
      onClose();
      onDone(res.data.id);
    } catch (err) {
      const fe = fieldErrors(err);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={!!clientId}
      title={inbound ? "New requirement" : "New project"}
      subtitle={inbound ? `${clientName ?? ""} called with a need` : clientName}
      icon={inbound ? PhoneIncoming : FolderPlus}
      tone={inbound ? "emerald" : "violet"}
      onClose={onClose}
      width="lg"
    >
      <div className="space-y-4">
        <InputField label="Project" required autoFocus placeholder="Enter project name" value={title} onChange={(e) => { setTitle(e.target.value); setErrors((x) => ({ ...x, title: "" })); }} error={errors.title} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Occasion" placeholder="None" value={occasion} options={[...new Set([...occasions, "Diwali", "New Year", "Holi", "Christmas", "Company anniversary", "Employee onboarding", "Other"])].map((o) => ({ value: o, label: o }))} onChange={(e) => setOccasion(e.target.value)} />
          {contacts.length > 1 && (
            <SelectField label="Contact" value={contactId} options={contacts.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setContactId(e.target.value)} />
          )}
          <InputField label={inbound ? "Quantity" : "Quantity (optional)"} type="number" integer required={inbound} value={quantity} onChange={(e) => { setQuantity(e.target.value); setErrors((x) => ({ ...x, quantity: "" })); }} error={errors.quantity} />
          <InputField label={inbound ? "Budget (₹)" : "Budget (₹, optional)"} type="number" required={inbound} value={budget} onChange={(e) => { setBudget(e.target.value); setErrors((x) => ({ ...x, budget: "" })); }} error={errors.budget} />
          <DatePicker label="Delivery date (optional)" min={todayIso()} value={delivery} onChange={setDelivery} />
        </div>
        <VoiceTextarea label="What they asked for (optional)" value={notes} onChange={setNotes} rows={3} placeholder="Write a note" />
        <Button onClick={save} loading={busy} className="w-full">{inbound ? "Save requirement" : "Create project"}</Button>
      </div>
    </Sheet>
  );
}
