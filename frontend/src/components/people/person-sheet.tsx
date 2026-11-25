"use client";
import { AlertTriangle, UserPlus, UserRoundPen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { errorData, fieldErrors, statusOf } from "@/lib/api-errors";
import { todayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { Duplicate, Person } from "@/types/people";
import { ADDRESS_LABELS, mobileText, RELATIONSHIPS } from "./labels";

type Form = {
  companyId: string; name: string; mobileNumber: string; email: string; designation: string; department: string;
  recipientType: "INTERNAL" | "EXTERNAL"; companyName: string; relationship: string; city: string;
  dateOfBirth: string; anniversaryDate: string; giftingOccasion: string; budget: string; birthdayBudget: string; anniversaryBudget: string;
  remark: string; addrLabel: string; addrLine1: string; addrLine2: string; addrCity: string; addrState: string; addrPin: string;
};
const EMPTY: Form = {
  companyId: "", name: "", mobileNumber: "", email: "", designation: "", department: "", recipientType: "INTERNAL", companyName: "",
  relationship: "", city: "", dateOfBirth: "", anniversaryDate: "", giftingOccasion: "", budget: "", birthdayBudget: "", anniversaryBudget: "",
  remark: "", addrLabel: "OFFICE", addrLine1: "", addrLine2: "", addrCity: "", addrState: "", addrPin: "",
};
const MOBILE = /^\+?[1-9][0-9]{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REASON: Record<string, string> = { SAME_MOBILE: "same mobile", SAME_EMAIL: "same email", SAME_NAME: "similar name" };

const fromPerson = (p: Person): Form => ({
  ...EMPTY, companyId: p.companyId, name: p.name, mobileNumber: mobileText(p.mobileNumber), email: p.email ?? "", designation: p.designation ?? "",
  department: p.department ?? "", recipientType: p.recipientType, companyName: p.companyName ?? "", relationship: p.relationship ?? "", city: p.city ?? "",
  dateOfBirth: p.dateOfBirth ?? "", anniversaryDate: p.anniversaryDate ?? "", giftingOccasion: p.giftingOccasion ?? "",
  budget: p.budget != null ? String(p.budget) : "", birthdayBudget: p.birthdayBudget != null ? String(p.birthdayBudget) : "",
  anniversaryBudget: p.anniversaryBudget != null ? String(p.anniversaryBudget) : "", remark: p.remark ?? "",
});

type Props = {
  open: boolean;
  person: Person | null;              // editing this one; null = adding
  accounts: { id: string; name: string }[];
  defaultCompanyId?: string;          // the account chosen in the list filter
  onClose: () => void;
  onSaved: (p: Person) => void;
};

/** Add or edit a person. Adding checks for duplicates first; editing refuses to overwrite a newer save. */
export function PersonSheet({ open, person, accounts, defaultCompanyId, onClose, onSaved }: Props) {
  const userId = useAppSelector((s) => s.auth.session?.profile.id);
  const draftKey = `people-draft:${userId ?? "me"}`;
  const [f, setF] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<Duplicate[] | null>(null);
  const [version, setVersion] = useState(1);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setDups(null); setConflict(false);
    if (person) { setF(fromPerson(person)); setVersion(person.version); setHasDraft(false); return; }
    setF({ ...EMPTY, companyId: defaultCompanyId ?? (accounts.length === 1 ? accounts[0].id : "") });
    try { setHasDraft(!!localStorage.getItem(draftKey)); } catch { setHasDraft(false); }
  }, [open, person, defaultCompanyId, accounts, draftKey]);

  // An unfinished new person is kept as a draft in this browser until it is saved.
  useEffect(() => {
    if (!open || person || !f.name.trim()) return;
    const t = setTimeout(() => { try { localStorage.setItem(draftKey, JSON.stringify(f)); } catch { /* storage unavailable */ } }, 500);
    return () => clearTimeout(t);
  }, [f, open, person, draftKey]);

  const set = (k: keyof Form) => (v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors((x) => ({ ...x, [k]: "" })); };
  const input = (k: keyof Form) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set(k)(e.target.value), error: errors[k] });
  const accountName = useMemo(() => accounts.find((a) => a.id === f.companyId)?.name, [accounts, f.companyId]);

  function check(): boolean {
    const e: Record<string, string> = {};
    if (!person && !f.companyId) e.companyId = "Pick the client account";
    if (!f.name.trim()) e.name = "Enter the name";
    const digits = f.mobileNumber.replace(/[\s\-()]/g, "");
    if (!digits) e.mobileNumber = "Enter the mobile number";
    else if (!MOBILE.test(digits) && !/^0?[6-9]\d{9}$/.test(digits)) e.mobileNumber = "Enter a valid mobile number";
    if (f.email && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email";
    for (const k of ["budget", "birthdayBudget", "anniversaryBudget"] as const) if (f[k] && !(Number(f[k]) >= 0)) e[k] = "Enter an amount";
    const anyAddr = f.addrLine1 || f.addrCity || f.addrPin;
    if (!person && anyAddr) {
      if (f.addrLine1.trim().length < 3) e.addrLine1 = "Enter the address";
      if (!f.addrCity.trim()) e.addrCity = "Enter the city";
      if (!/^\d{6}$/.test(f.addrPin.trim())) e.addrPin = "Enter the 6-digit PIN";
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const body = () => ({
    name: f.name.trim(), mobileNumber: f.mobileNumber.trim(), email: f.email.trim() || null, designation: f.designation.trim() || null,
    department: f.department.trim() || null, recipientType: f.recipientType, companyName: f.recipientType === "EXTERNAL" ? f.companyName.trim() || null : null,
    relationship: f.relationship || null, city: f.city.trim() || null, dateOfBirth: f.dateOfBirth || null, anniversaryDate: f.anniversaryDate || null,
    giftingOccasion: f.giftingOccasion.trim() || null, budget: num(f.budget), birthdayBudget: num(f.birthdayBudget), anniversaryBudget: num(f.anniversaryBudget),
    remark: f.remark.trim() || null,
  });

  async function save(allowDuplicate = false) {
    if (!check()) return;
    setBusy(true);
    try {
      let saved: Person;
      if (person) {
        saved = (await apiClient.patch<Person>(`/people/${person.id}`, { ...body(), version })).data;
        toast.success("Saved");
      } else {
        const address = f.addrLine1.trim()
          ? { label: f.addrLabel, addressLine1: f.addrLine1.trim(), addressLine2: f.addrLine2.trim() || null, city: f.addrCity.trim(), state: f.addrState.trim() || null, postalCode: f.addrPin.trim(), country: "IN" }
          : null;
        saved = (await apiClient.post<Person>("/people", { ...body(), companyId: f.companyId, allowDuplicate, address })).data;
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        toast.success(`${saved.name} added`);
      }
      onClose();
      onSaved(saved);
    } catch (err) {
      const data = errorData<{ duplicates?: Duplicate[]; reason?: string; current?: Person }>(err);
      if (statusOf(err) === 409 && data?.duplicates?.length) setDups(data.duplicates);
      else if (statusOf(err) === 409 && data?.reason === "VERSION_CONFLICT" && data.current) {
        setF(fromPerson(data.current)); setVersion(data.current.version); setConflict(true);
      } else {
        const fe = fieldErrors(err);
        if (Object.keys(fe).length) setErrors(fe);
        else toast.error(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) ?? "null") as Form | null;
      if (d) setF({ ...EMPTY, ...d });
    } catch { /* bad draft */ }
    setHasDraft(false);
  }

  const section = "space-y-3 rounded-2xl border border-slate-200 p-3.5";
  const head = "text-xs font-semibold uppercase tracking-wide text-slate-500";
  return (
    <Sheet open={open} title={person ? "Edit person" : "Add person"} subtitle={person ? `${person.name}${accountName ? ` · ${accountName}` : ""}` : accountName} icon={person ? UserRoundPen : UserPlus} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        {hasDraft && !person && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <span>You have an unsaved person from before.</span>
            <div className="flex gap-1">
              <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } setHasDraft(false); }}>Discard</Button>
              <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={restoreDraft}>Continue it</Button>
            </div>
          </div>
        )}
        {conflict && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Someone else saved this person while you were editing. Their latest details are loaded below: check them and save again.
          </p>
        )}
        {dups && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />This person may already be here</p>
            <ul className="space-y-1">
              {dups.map((d) => (
                <li key={d.id} className="text-slate-700"><b className="font-semibold">{d.name}</b>{d.mobileNumber ? ` · ${mobileText(d.mobileNumber)}` : ""}{d.city ? ` · ${d.city}` : ""} <span className="text-xs text-amber-800">({d.reasons.map((r) => REASON[r]).join(", ")})</span></li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setDups(null)}>Go back and check</Button>
              {!dups.some((d) => d.reasons.includes("SAME_MOBILE")) && (
                <Button className="min-h-8 px-3 text-xs" loading={busy} onClick={() => void save(true)}>This is a different person, save anyway</Button>
              )}
            </div>
            {dups.some((d) => d.reasons.includes("SAME_MOBILE")) && <p className="text-xs text-amber-800">Two people of one client can't share a mobile number.</p>}
          </div>
        )}

        {!person && accounts.length > 1 && (
          <SelectField label="Client account" required placeholder="Select" value={f.companyId} onChange={(e) => set("companyId")(e.target.value)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={errors.companyId} />
        )}

        <section className={section} aria-label="Details">
          <h3 className={head}>Details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField label="Full name" required maxLength={200} {...input("name")} />
            <InputField label="Mobile number" required type="tel" placeholder="98765 43210" {...input("mobileNumber")} />
            <InputField label="Email" type="email" {...input("email")} />
            <SelectField label="Relationship" placeholder="Select" value={f.relationship} onChange={(e) => set("relationship")(e.target.value)} options={RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }))} />
            <InputField label="Designation" maxLength={120} {...input("designation")} />
            <InputField label="Department" maxLength={120} {...input("department")} />
            <InputField label="City" maxLength={100} {...input("city")} />
            <SelectField label="Type" value={f.recipientType} onChange={(e) => set("recipientType")(e.target.value)}
              options={[{ value: "INTERNAL", label: "Internal (the client's own people)" }, { value: "EXTERNAL", label: "External (outside the client)" }]} />
            {f.recipientType === "EXTERNAL" && <InputField label="Their company" maxLength={200} {...input("companyName")} />}
          </div>
        </section>

        <section className={section} aria-label="Occasions and budget">
          <h3 className={head}>Occasions and budget</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker label="Date of birth" value={f.dateOfBirth} onChange={set("dateOfBirth")} max={todayIso()} />
            <DatePicker label="Anniversary" value={f.anniversaryDate} onChange={set("anniversaryDate")} />
            <InputField label="Gifting occasion" placeholder="e.g. Diwali" maxLength={200} {...input("giftingOccasion")} />
            <InputField label="Budget (₹)" type="number" min={0} {...input("budget")} />
            <InputField label="Birthday budget (₹)" type="number" min={0} {...input("birthdayBudget")} />
            <InputField label="Anniversary budget (₹)" type="number" min={0} {...input("anniversaryBudget")} />
          </div>
        </section>

        {!person && (
          <section className={section} aria-label="Delivery address">
            <h3 className={head}>Delivery address <span className="font-normal normal-case tracking-normal text-slate-400">(optional; more can be added later)</span></h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Type" value={f.addrLabel} onChange={(e) => set("addrLabel")(e.target.value)} options={ADDRESS_LABELS} />
              <InputField label="PIN code" inputMode="numeric" maxLength={6} {...input("addrPin")} />
              <div className="sm:col-span-2"><InputField label="Address line 1" {...input("addrLine1")} /></div>
              <InputField label="Address line 2" {...input("addrLine2")} />
              <InputField label="City" {...input("addrCity")} />
              <InputField label="State" {...input("addrState")} />
            </div>
          </section>
        )}

        <TextareaField label="Remark" rows={2} maxLength={2000} value={f.remark} onChange={(e) => set("remark")(e.target.value)} />
        <Button onClick={() => void save()} loading={busy && !dups} className="w-full">{person ? "Save" : "Add person"}</Button>
      </div>
    </Sheet>
  );
}
