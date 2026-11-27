"use client";
import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ALL_CLIENTS } from "@/components/os/client-gate";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { TextareaField } from "@/components/ui/input-field";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { apiClient, errorMessage } from "@/services/api-client";

export type DayDraft = { id?: string; companyId?: string; name: string; day: string; description: string; repeatAnnually: boolean };
export const NEW_DAY: DayDraft = { name: "", day: "", description: "", repeatAnnually: false };

type Props = { companyId: string; kind: "occasion" | "event"; draft: DayDraft | null; onClose: () => void; onSaved: () => void };

/** Add or change an occasion (for the whole client) or an event (for one person). */
export function DaySheet({ companyId, kind, draft, onClose, onSaved }: Props) {
  const [v, setV] = useState<DayDraft>(NEW_DAY);
  const [chosen, setChosen] = useState("");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const q = useDebounce(search, 300);
  // Under "All clients" a new entry asks which client it is for; an existing one already knows.
  const asksClient = companyId === ALL_CLIENTS && !draft?.id;
  const target = draft?.companyId ?? (companyId === ALL_CLIENTS ? chosen : companyId);
  const accounts = useApi<{ id: string; name: string }[]>(draft && asksClient ? "/gifting-planning/accounts" : null);
  const needsPerson = kind === "event" && !draft?.id;
  const people = useApi<{ id: string; name: string }[]>(draft && needsPerson && target ? `/os/${target}/recipients` : null, { q: q || undefined });
  useEffect(() => { if (draft) { setV(draft); setChosen(""); setPerson(""); setSearch(""); setErrors({}); } }, [draft]);

  async function save() {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = "Name is required";
    if (!v.day) e.day = "Pick a date";
    if (!target) e.client = "Choose a client";
    if (needsPerson && !person) e.person = "Choose a person";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { name: v.name.trim(), day: v.day, description: v.description.trim() || null, repeatAnnually: v.repeatAnnually, ...(needsPerson ? { recipientId: person } : {}) };
      const base = `/os/${target}/${kind}s`;
      await (v.id ? apiClient.patch(`${base}/${v.id}`, body) : apiClient.post(base, body));
      toast.success(`${kind === "event" ? "Event" : "Occasion"} saved`);
      onClose();
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!draft} title={`${draft?.id ? "Edit" : "New"} ${kind}`} icon={CalendarDays} tone="sky" onClose={onClose}>
      <div className="space-y-4">
        {asksClient && (
          <SelectField label="Client" required value={chosen} error={errors.client} placeholder="Choose a client"
            options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} onChange={(e) => { setChosen(e.target.value); setPerson(""); }} />
        )}
        {needsPerson && (
          <>
            <InputField label="Search person" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name" />
            <SelectField label="Person" required value={person} error={errors.person} placeholder={people.data?.length === 0 ? "No one found" : "Choose a person"}
              options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(e) => setPerson(e.target.value)} />
          </>
        )}
        <InputField label="Name" required maxLength={150} value={v.name} error={errors.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <DatePicker label="Date" required value={v.day} error={errors.day} onChange={(day) => setV({ ...v, day })} />
        <TextareaField label="Description" rows={3} maxLength={2000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={v.repeatAnnually} onChange={(e) => setV({ ...v, repeatAnnually: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-brand" />
          Repeats every year
        </label>
        <Button className="w-full" loading={busy} onClick={() => void save()}>Save</Button>
      </div>
    </Sheet>
  );
}
