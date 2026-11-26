"use client";
import { Gift, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { apiClient, errorMessage } from "@/services/api-client";
import type { PlanningOptions } from "@/types/gifting";
import type { PeopleList } from "@/types/people";
import { dayText } from "./labels";

// The same choices as the Gifting OS request form.
const INITIATED = [
  { value: "DIRECTOR_WHATSAPP", label: "Director (via WhatsApp)" }, { value: "DIRECTOR_EMAIL", label: "Director (via Email)" },
  { value: "DIRECTOR_CALL", label: "Director (via Call)" }, { value: "DIRECTOR_MEETING", label: "Director (in a meeting)" },
  { value: "HR_REQUEST", label: "HR request" }, { value: "SELF", label: "Self-initiated" }, { value: "OTHER", label: "Other" },
];
const RELATIONSHIPS = ["Business Partner", "Client", "Employee", "Leadership", "Vendor / Supplier", "Family", "Friend", "Other"].map((v) => ({ value: v, label: v }));
const START = { recipientId: "", recipientName: "", source: "occasion", sourceId: "", deliveryDate: "", budgetMode: "SPECIFIC", budget: "", initiatedVia: "", relationship: "", deliveryAddress: "", specialInstructions: "" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** A gift request raised by the KAM for a client, with a new occasion or event made on the way if needed. */
export function NewRequestSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const accounts = useApi<{ id: string; name: string }[]>(open ? "/gifting-planning/accounts" : null);
  const [companyId, setCompanyId] = useState("");
  const [f, setF] = useState(START);
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 300);
  const [adding, setAdding] = useState<{ name: string; day: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setCompanyId(""); setF(START); setSearch(""); setAdding(null); setError(""); } }, [open]);
  useEffect(() => { if (open && !companyId && accounts.data?.length === 1) setCompanyId(accounts.data[0].id); }, [open, companyId, accounts.data]);

  const people = useApi<PeopleList>(open && companyId && !f.recipientId ? "/people" : null, { companyId, search: q || undefined, limit: 20, sort: "name" });
  const options = useApi<PlanningOptions>(open && companyId ? "/gifting-planning/options" : null, { companyId, recipientId: f.recipientId || undefined });
  const set = (patch: Partial<typeof START>) => { setF((c) => ({ ...c, ...patch })); setError(""); };
  const isEvent = f.source === "event";
  const choices = (isEvent ? options.data?.events : options.data?.occasions) ?? [];
  const off = options.data?.actionsEnabled === false;

  async function addDay() {
    if (!adding) return;
    if (!adding.name.trim() || !adding.day) return setError("Enter a name and a date.");
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>(isEvent ? "/gifting-planning/events" : "/gifting-planning/occasions",
        { companyId, name: adding.name.trim(), day: adding.day, ...(isEvent ? { recipientId: f.recipientId } : {}) });
      toast.success(isEvent ? "Event created" : "Occasion created");
      await options.reload();
      set({ sourceId: res.data.id });
      setAdding(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function send() {
    const missing = [!f.recipientId && "a recipient", !f.sourceId && `an ${f.source}`, !f.deliveryDate && "the delivery date",
      f.budgetMode === "SPECIFIC" && !(Number(f.budget) > 0) && "a budget", !f.initiatedVia && "how it was initiated", !f.relationship && "the relationship"].filter(Boolean);
    if (missing.length) return setError(`Please add ${missing.join(", ")}.`);
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string; requestCode?: string }>("/gifting-planning/requests", {
        companyId, recipientId: f.recipientId, [isEvent ? "eventId" : "occasionId"]: f.sourceId, deliveryDate: f.deliveryDate,
        budgetMode: f.budgetMode, budget: f.budgetMode === "SPECIFIC" ? Number(f.budget) : undefined, initiatedVia: f.initiatedVia, relationship: f.relationship,
        deliveryAddress: f.deliveryAddress.trim() || undefined, specialInstructions: f.specialInstructions.trim() || undefined,
      });
      toast.success(`Gift request ${res.data.requestCode ?? ""} sent`);
      onClose();
      onCreated(res.data.id);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} title="New gift request" subtitle="Raise a request for a client" icon={Gift} tone="indigo" onClose={onClose} width="lg">
      <div className="space-y-4">
        {off && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">Acting from the CRM is switched off in Gifting OS, so nothing can be created yet.</p>}
        {accounts.error && <p role="alert" className="text-sm text-red-600">{accounts.error}</p>}
        <SelectField label="Client account" required placeholder="Select" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setF(START); setSearch(""); setAdding(null); }}
          options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        {options.error && <p role="alert" className="text-sm text-red-600">{options.error}</p>}
        {companyId && (
          <>
            {f.recipientId ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                <span><span className="block text-xs text-slate-500">Recipient</span><span className="font-medium text-slate-900">{f.recipientName}</span></span>
                <button type="button" aria-label="Change recipient" onClick={() => { set({ recipientId: "", recipientName: "", sourceId: "" }); setAdding(null); }} className="pressable rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="text-sm font-medium text-slate-700">Recipient</span>
                <SearchInput className="sm:w-full" value={search} onChange={setSearch} placeholder="Search people" />
                <ul className="max-h-[min(14rem,30vh)] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {(people.data?.items ?? []).map((p) => (
                    <li key={p.id}><button type="button" onClick={() => set({ recipientId: p.id, recipientName: p.name })} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"><span className="truncate text-slate-800">{p.name}</span><span className="text-xs text-slate-400">{p.city}</span></button></li>
                  ))}
                  {people.data && !people.data.items.length && <li className="px-3 py-4 text-center text-sm text-slate-400">No people match.</li>}
                </ul>
              </div>
            )}
            <SelectField label="This gift is for" value={f.source} onChange={(e) => { set({ source: e.target.value, sourceId: "" }); setAdding(null); }}
              options={[{ value: "occasion", label: "An occasion (such as Diwali)" }, { value: "event", label: "A personal event of the recipient" }]} />
            {isEvent && !f.recipientId ? <p className="text-sm text-slate-500">Choose the recipient first to see their events.</p> : (
              <div className="space-y-2">
                <SelectField label={isEvent ? "Event" : "Occasion"} required placeholder={options.loading && !options.data ? "Loading…" : "Select"} value={f.sourceId} onChange={(e) => set({ sourceId: e.target.value })}
                  options={choices.map((c) => ({ value: c.id, label: c.date ? `${c.name} (${dayText(c.date)})` : c.name }))} />
                {adding ? (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <InputField label={isEvent ? "Event name" : "Occasion name"} required maxLength={150} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                    <DatePicker label="Date" required value={adding.day} onChange={(day) => setAdding({ ...adding, day })} />
                    <div className="flex justify-end gap-2"><Button variant="secondary" disabled={busy} onClick={() => setAdding(null)}>Cancel</Button><Button loading={busy} disabled={off} onClick={() => void addDay()}>Create</Button></div>
                  </div>
                ) : <Button variant="ghost" className="px-2 text-brand" disabled={off} onClick={() => setAdding({ name: "", day: "" })}><Plus className="h-4 w-4" />New {f.source}</Button>}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <DatePicker label="Deliver by" required min={today()} value={f.deliveryDate} onChange={(deliveryDate) => set({ deliveryDate })} />
              <SelectField label="Budget" value={f.budgetMode} onChange={(e) => set({ budgetMode: e.target.value })} options={[{ value: "SPECIFIC", label: "Fixed amount" }, { value: "TOFAA_RECOMMEND", label: "Let TOFAA recommend" }]} />
              {f.budgetMode === "SPECIFIC" && <InputField label="Amount (₹)" required inputMode="decimal" value={f.budget} onChange={(e) => set({ budget: e.target.value.replace(/[^0-9.]/g, "") })} />}
              <SelectField label="Initiated by" required placeholder="Select" value={f.initiatedVia} onChange={(e) => set({ initiatedVia: e.target.value })} options={INITIATED} />
              <SelectField label="Relationship" required placeholder="Select" value={f.relationship} onChange={(e) => set({ relationship: e.target.value })} options={RELATIONSHIPS} />
            </div>
            <InputField label="Delivery address" maxLength={600} value={f.deliveryAddress} onChange={(e) => set({ deliveryAddress: e.target.value })} />
            <InputField label="Special instructions" maxLength={500} value={f.specialInstructions} onChange={(e) => set({ specialInstructions: e.target.value })} />
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {/* Pinned to the bottom of the dialog, so the buttons never need scrolling to reach. */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-8 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3 sm:-mb-6">
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button loading={busy && !adding} disabled={off || !companyId || busy} onClick={() => void send()}>Send request</Button>
        </div>
      </div>
    </Sheet>
  );
}
