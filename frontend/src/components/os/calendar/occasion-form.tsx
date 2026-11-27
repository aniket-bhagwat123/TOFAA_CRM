"use client";
import { Building2, CalendarPlus, Check, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ALL_CLIENTS } from "@/components/os/client-gate";
import { RELATIONSHIP_OPTIONS } from "@/components/gifting/shared";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { OverviewItem, Priority } from "@/types/os-modules";
import { SidePanel } from "./side-panel";

type Mode = "RECIPIENT" | "COMPANY";
const OCCASION_TYPES = ["Birthday", "Anniversary", "Work Anniversary", "Other"];
const COMPANY_CATEGORIES = ["Annual Event", "Festival", "Company Milestone", "Celebration", "Other"];
const PRIORITIES: { value: Priority; label: string }[] = [{ value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "VIP", label: "VIP" }];
const heading = "text-base font-semibold text-slate-900";
const options = (list: string[]) => list.map((value) => ({ value, label: value }));

type Props = { companyId: string; editing: OverviewItem | null; date?: string; onClose: () => void; onSaved: () => void };

function initial(editing: OverviewItem | null, date?: string) {
  const person = editing?.sourceType === "RECIPIENT";
  const known = !!editing && OCCASION_TYPES.includes(editing.label);
  return {
    mode: (editing?.sourceType ?? "RECIPIENT") as Mode, client: "", recipientId: editing?.recipientId ?? "", relationship: editing?.relationship ?? "",
    occasionType: person ? (known ? editing!.label : "Other") : "", customName: person && !known ? editing!.label : "",
    date: editing ? editing.sourceDate ?? editing.date : date ?? "", repeat: !!editing?.repeatAnnually,
    priority: (editing?.priority ?? "NORMAL") as Priority, notes: editing?.notes ?? "",
    eventName: editing && !person ? editing.name : "", category: editing && !person ? editing.label : "", description: editing?.description ?? "",
  };
}

/** Add an occasion (a date for one person, or for the whole company), or change one. Mount it only while open. */
export function OccasionForm({ companyId, editing, date, onClose, onSaved }: Props) {
  const [form, setForm] = useState(() => initial(editing, date));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search, 300);
  const set = (patch: Partial<typeof form>) => { setForm((c) => ({ ...c, ...patch })); setErrors({}); };
  const company = form.mode === "COMPANY";
  // Under "All clients" a new entry asks which client it is for; an existing one already knows.
  const asksClient = companyId === ALL_CLIENTS && !editing;
  const target = editing?.accountId ?? (companyId === ALL_CLIENTS ? form.client : companyId);
  const accounts = useApi<{ id: string; name: string }[]>(asksClient ? "/gifting-planning/accounts" : null);
  const people = useApi<{ id: string; name: string }[]>(!editing && !company && target ? `/os/${target}/recipients` : null, { q: q || undefined });
  const categories = form.category && !COMPANY_CATEGORIES.includes(form.category) ? [...COMPANY_CATEGORIES, form.category] : COMPANY_CATEGORIES;
  const relationships = form.relationship && !RELATIONSHIP_OPTIONS.includes(form.relationship) ? [...RELATIONSHIP_OPTIONS, form.relationship] : RELATIONSHIP_OPTIONS;
  const HeaderIcon = company ? Building2 : CalendarPlus;

  async function save(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!target) next.client = "Choose a client.";
    if (company) {
      if (!form.eventName.trim()) next.eventName = "Enter the event name.";
      if (!form.category) next.category = "Choose a category.";
    } else {
      if (!editing && !form.recipientId) next.recipientId = "Choose a recipient.";
      if (!form.occasionType) next.occasionType = "Choose an occasion.";
      if (form.occasionType === "Other" && !form.customName.trim()) next.customName = "Name the occasion.";
    }
    if (!form.date) next.date = "Pick a date.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const common = { day: form.date, repeatAnnually: form.repeat, priority: form.priority, notes: form.notes.trim() || null };
      const label = form.occasionType === "Other" ? form.customName.trim() : form.occasionType;
      const body = company
        ? { ...common, name: form.eventName.trim(), category: form.category, description: form.description.trim() || null }
        : { ...common, name: label, occasionType: label, relationship: form.relationship || null, ...(editing ? {} : { recipientId: form.recipientId }) };
      const base = `/os/${target}/${company ? "occasions" : "events"}`;
      const id = company ? editing?.occasionId : editing?.eventId;
      await (id ? apiClient.patch(`${base}/${id}`, body) : apiClient.post(base, body));
      toast.success(editing ? "Occasion updated" : "Occasion saved");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const repeat = (text: string) => (
    <label className="flex items-center gap-2.5 text-sm text-slate-900"><input type="checkbox" checked={form.repeat} onChange={(e) => set({ repeat: e.target.checked })} className="h-5 w-5 accent-brand" />{text}</label>
  );

  return (
    <SidePanel label={editing ? "Edit Occasion" : "Add Occasion"} onClose={() => { if (!busy) onClose(); }}>
      <form noValidate onSubmit={(e) => void save(e)} className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><HeaderIcon size={24} /></span>
          <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold text-slate-900">{editing ? "Edit Occasion" : "Add Occasion"}</h2><p className="text-sm text-slate-500">{editing ? "Change the details of this occasion." : "Add an important date to the client's gifting calendar."}</p></div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="pressable rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={20} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {!editing && (
            <div role="tablist" aria-label="Occasion type" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {([["RECIPIENT", "Recipient Occasion"], ["COMPANY", "Company Occasion"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={form.mode === value} onClick={() => set({ mode: value })} className={cn("pressable min-h-11 rounded-xl px-3 text-sm font-semibold", form.mode === value ? "border border-brand bg-white text-brand shadow-sm" : "text-slate-700")}>{label}</button>
              ))}
            </div>
          )}
          {asksClient && (
            <SelectField label="Client" required value={form.client} error={errors.client} placeholder="Choose a client"
              options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} onChange={(e) => set({ client: e.target.value, recipientId: "" })} />
          )}

          {company ? (
            <>
              <section className="space-y-4"><h3 className={heading}>1. Event Details</h3>
                <InputField label="Event Name" required maxLength={150} placeholder="e.g. Annual Day Celebration" value={form.eventName} error={errors.eventName} onChange={(e) => set({ eventName: e.target.value })} />
                <SelectField label="Event Category" required value={form.category} error={errors.category} placeholder="Select category" options={options(categories)} onChange={(e) => set({ category: e.target.value })} />
                <div><TextareaField label="Description (Optional)" rows={3} maxLength={200} placeholder="Add more details about the event…" value={form.description} onChange={(e) => set({ description: e.target.value })} /><p className="mt-1 text-right text-xs text-slate-500">{form.description.length}/200</p></div>
              </section>
              <section className="space-y-3 border-t border-slate-200 pt-5"><h3 className={heading}>2. Event Date</h3>
                <DatePicker label="Event Date" required value={form.date} error={errors.date} onChange={(value) => set({ date: value })} />
                {repeat("Repeat annually")}
              </section>
            </>
          ) : (
            <>
              <section className="space-y-4"><h3 className={heading}>1. Recipient Details</h3>
                {editing ? <InputField label="Recipient" value={editing.name} readOnly /> : (
                  <div className="space-y-2">
                    <InputField label="Search recipient" value={search} disabled={!target} onChange={(e) => setSearch(e.target.value)} />
                    <SelectField label="Recipient" required value={form.recipientId} error={errors.recipientId} placeholder={!target ? "Choose the client first" : people.data?.length === 0 ? "No one found" : "Select recipient"}
                      options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => set({ recipientId: e.target.value })} />
                  </div>
                )}
                <SelectField label="Relationship" value={form.relationship} placeholder="Select relationship" options={options(relationships)} onChange={(e) => set({ relationship: e.target.value })} />
              </section>
              <section className="space-y-4 border-t border-slate-200 pt-5"><h3 className={heading}>2. Occasion Details</h3>
                <SelectField label="Occasion" required value={form.occasionType} error={errors.occasionType} placeholder="Select occasion" options={options(OCCASION_TYPES)} onChange={(e) => set({ occasionType: e.target.value })} />
                {form.occasionType === "Other" && <InputField label="Occasion name" required maxLength={60} placeholder="e.g. Promotion" value={form.customName} error={errors.customName} onChange={(e) => set({ customName: e.target.value })} />}
                <DatePicker label="Occasion Date" required value={form.date} error={errors.date} onChange={(value) => set({ date: value })} />
                {repeat("Repeat every year")}
              </section>
            </>
          )}

          <section className="space-y-3 border-t border-slate-200 pt-5"><h3 className={heading}>{company ? "3. Planning Preferences" : "3. Priority & Notes"}</h3>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-900">Priority</span>
              <div role="radiogroup" aria-label="Priority" className="flex flex-wrap gap-2">
                {PRIORITIES.map((p) => <button key={p.value} type="button" role="radio" aria-checked={form.priority === p.value} onClick={() => set({ priority: p.value })} className={cn("pressable inline-flex min-h-10 items-center gap-1.5 rounded-full border px-5 text-sm font-semibold", form.priority === p.value ? "border-brand bg-brand-soft text-brand" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{form.priority === p.value && <Check size={15} aria-hidden />}{p.label}</button>)}
              </div>
            </div>
            <TextareaField label="Internal Notes (Optional)" rows={3} maxLength={2000} placeholder="Add any useful context…" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </section>
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-200 px-5 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>{editing ? "Save changes" : "Save Occasion"}</Button>
        </footer>
      </form>
    </SidePanel>
  );
}
