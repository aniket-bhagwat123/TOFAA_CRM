"use client";
/** The four steps of the Add / Edit Recipient panel: the structure of Gifting OS's, in the CRM's colours. */
import { AlertTriangle, ChevronDown, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { RequiredMark } from "@/components/ui/required-mark";
import { SelectField } from "@/components/ui/select-field";
import { formatDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Duplicate } from "@/types/people";
import { mobileText, RELATIONSHIPS } from "../labels";
import {
  type Address, COUNTRY_CODES, type Details, type Errors, type GroupRef, newKey, type Occasion, OCCASION_TYPES, occasionLabel, type Preferences,
  validateOccasion, type WizardData,
} from "./types";

const BOX = "rounded-xl border border-slate-200 px-4 py-3";
const CHECK = "h-4 w-4 rounded border-slate-300 text-brand";
const SMALL = "min-h-9 px-3 py-1.5 text-xs";
const day = (iso: string) => `${formatDate(iso)} ${iso.slice(0, 4)}`;

// --------------------------------------------------------------------------------------------- step 1: details
function PhotoPicker({ name, src, onPick }: { name: string; src: string | null; onPick: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const choose = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return void toast.error("Choose a PNG, JPG or WebP image.");
    if (file.size > 2 * 1024 * 1024) return void toast.error("That image is over 2 MB. Choose a smaller one.");
    onPick(file);
  };
  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={src} size="md" />
      <div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Upload a profile photo" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className={SMALL} onClick={() => input.current?.click()}><ImagePlus className="h-4 w-4" />{src ? "Change photo" : "Upload photo"}</Button>
          {src && <Button type="button" variant="ghost" className={cn(SMALL, "text-red-600 hover:bg-red-50")} onClick={() => onPick(null)}><Trash2 className="h-3.5 w-3.5" />Remove</Button>}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">PNG, JPG or WebP, up to 2 MB.</p>
      </div>
    </div>
  );
}

/** A country code and the number, as in Gifting OS. */
function MobileField({ value, error, onChange }: { value: string; error?: string; onChange: (v: string) => void }) {
  const text = value.replace(/[\s()-]/g, "");
  const found = [...COUNTRY_CODES].sort((a, b) => b.length - a.length).find((c) => text.startsWith(c));
  const code = found ?? "+91";
  const number = found ? text.slice(found.length) : text.replace(/^\+/, "");
  const set = (c: string, n: string) => { const digits = n.replace(/\D/g, "").slice(0, 14); onChange(digits ? `${c}${digits}` : ""); };
  return (
    <div className="space-y-1">
      <label htmlFor="wz-mobile" className="block text-sm font-medium text-slate-700">Mobile number<RequiredMark /></label>
      <div className={cn("flex overflow-hidden rounded-xl border bg-white focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15", error ? "border-red-400 ring-4 ring-red-100" : "border-slate-300/80")}>
        <select aria-label="Country code" value={code} onChange={(e) => set(e.target.value, number)} className="border-r border-slate-200 bg-transparent px-2 text-sm outline-none">
          {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input id="wz-mobile" type="tel" inputMode="numeric" placeholder="Enter mobile number" value={number} aria-invalid={!!error || undefined} onChange={(e) => set(code, e.target.value)} className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
      </div>
      {error && <span role="alert" className="block text-xs font-medium text-red-600">{error}</span>}
    </div>
  );
}

/** "Add to the group": pick from the client's groups, or type a new name to create the group when saving. */
function GroupPicker({ groups, groupIds, newGroupName, onChange }: { groups: GroupRef[]; groupIds: string[]; newGroupName: string; onChange: (p: Partial<WizardData>) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const typed = query.trim();
  const available = groups.filter((g) => !groupIds.includes(g.id) && g.name.toLowerCase().includes(typed.toLowerCase()));
  const exact = groups.some((g) => g.name.trim().toLowerCase() === typed.toLowerCase()) || newGroupName.trim().toLowerCase() === typed.toLowerCase();
  const pick = (id: string) => { onChange({ groupIds: [...groupIds, id] }); setQuery(""); };
  const create = () => { onChange({ newGroupName: typed }); setQuery(""); setOpen(false); };
  const selected = groups.filter((g) => groupIds.includes(g.id));
  const chip = "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium";
  return (
    <div>
      <label htmlFor="group-picker" className="block text-sm font-medium text-slate-700">Add to the group</label>
      {(selected.length > 0 || newGroupName.trim()) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((g) => <span key={g.id} className={cn(chip, "bg-brand-soft text-brand")}>{g.name}<button type="button" aria-label={`Remove ${g.name}`} onClick={() => onChange({ groupIds: groupIds.filter((id) => id !== g.id) })}><X className="h-3.5 w-3.5" /></button></span>)}
          {newGroupName.trim() && <span className={cn(chip, "bg-amber-50 text-amber-800")}>{newGroupName.trim()} <span className="text-xs font-normal">(new)</span><button type="button" aria-label="Remove new group" onClick={() => onChange({ newGroupName: "" })}><X className="h-3.5 w-3.5" /></button></span>}
        </div>
      )}
      <div className="relative mt-1">
        <input id="group-picker" autoComplete="off" value={query} placeholder={groups.length ? "Select a group or enter a new name" : "Enter group name"}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (typed && !exact && !available.length) create(); else if (typed && available[0]) pick(available[0].id); } if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}
          className="w-full rounded-xl border border-slate-300/80 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-4 focus:ring-brand/15" />
        {open && (available.length > 0 || (typed && !exact)) && (
          <ul role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-float">
            {available.map((g) => <li key={g.id}><button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(g.id)} className="flex w-full px-3 py-2 text-left text-sm hover:bg-slate-50">{g.name}</button></li>)}
            {typed && !exact && <li><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={create} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-brand hover:bg-brand-soft"><Plus className="h-3.5 w-3.5" />Create group “{typed}”</button></li>}
          </ul>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">Can&apos;t find the group? Type its name and choose Create. It is added to Groups when you save.</p>
    </div>
  );
}

const REASON: Record<string, string> = { SAME_MOBILE: "Same mobile number", SAME_EMAIL: "Same email", SAME_NAME: "Same name" };

export function DetailsStep({ data, errors, photoUrl, accounts, askClient, groups, duplicates, onChange, onDetails, onPhoto, onConfirmDifferent }: {
  data: WizardData; errors: Errors; photoUrl: string | null; accounts: { id: string; name: string }[]; askClient: boolean; groups: GroupRef[]; duplicates: Duplicate[];
  onChange: (p: Partial<WizardData>) => void; onDetails: (p: Partial<Details>) => void; onPhoto: (f: File | null) => void; onConfirmDifferent: () => void;
}) {
  const d = data.details;
  const [more, setMore] = useState(false);
  const field = (key: keyof Details) => ({ value: d[key] as string, error: errors[key], onChange: (e: { target: { value: string } }) => onDetails({ [key]: e.target.value }) });
  const hidden = ["designation", "budget", "birthdayBudget", "anniversaryBudget"].some((k) => errors[k]);
  const sameMobile = duplicates.some((m) => m.reasons.includes("SAME_MOBILE"));
  return (
    <div className="space-y-5">
      <PhotoPicker name={d.name} src={photoUrl} onPick={onPhoto} />
      <div className="grid gap-4 sm:grid-cols-2">
        {askClient && (
          <div className="sm:col-span-2">
            <SelectField label="Client" required value={data.companyId} error={errors.companyId} placeholder="Choose a client" options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={(e) => onChange({ companyId: e.target.value, groupIds: [], newGroupName: "", allowDuplicate: false })} />
          </div>
        )}
        <div className="sm:col-span-2"><InputField label="Full name" required autoComplete="off" {...field("name")} /></div>
        <MobileField value={d.mobile} error={errors.mobile} onChange={(mobile) => onDetails({ mobile })} />
        <InputField label="Email address (optional)" type="email" {...field("email")} />
        <div className="sm:col-span-2"><GroupPicker groups={groups} groupIds={data.groupIds} newGroupName={data.newGroupName} onChange={onChange} /></div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-slate-700">Recipient type<RequiredMark /></legend>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {(["EXTERNAL", "INTERNAL"] as const).map((value) => (
            <label key={value} className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 rounded-full border px-4 text-sm font-medium", d.recipientType === value ? "border-brand/50 bg-brand-soft text-brand" : "border-slate-200 bg-white hover:bg-slate-50")}>
              <input type="radio" name="recipient-type" checked={d.recipientType === value} onChange={() => onDetails({ recipientType: value })} className="h-4 w-4 text-brand" />{value === "EXTERNAL" ? "External" : "Internal"}
            </label>
          ))}
        </div>
      </fieldset>
      {d.recipientType === "EXTERNAL" && <div className="sm:max-w-[calc(50%-0.5rem)]"><InputField label="Company / organisation (optional)" maxLength={200} {...field("company")} /></div>}

      <div className={BOX}>
        <button type="button" aria-expanded={more || hidden} onClick={() => setMore((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-slate-800">
          More details <span className="font-normal text-slate-500">relationship, designation, budgets</span><ChevronDown className={cn("ml-auto h-4 w-4 transition-transform", (more || hidden) && "rotate-180")} />
        </button>
        {(more || hidden) && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField label="Relationship" value={d.relationship} options={[{ value: "", label: "Not set" }, ...RELATIONSHIPS.map((r) => ({ value: r.value, label: r.label }))]} onChange={(e) => onDetails({ relationship: e.target.value })} />
            <InputField label="Designation" {...field("designation")} />
            <InputField label="Department" maxLength={120} {...field("department")} />
            <InputField label="City" maxLength={100} {...field("city")} />
            <InputField label="Gifting occasion" maxLength={200} {...field("giftingOccasion")} />
            <InputField label="Budget (₹)" type="number" {...field("budget")} />
            <InputField label="Birthday budget (₹)" type="number" {...field("birthdayBudget")} />
            <InputField label="Anniversary budget (₹)" type="number" {...field("anniversaryBudget")} />
            <div className="sm:col-span-2"><TextareaField label="Remark" rows={2} maxLength={2000} {...field("remark")} /></div>
            <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" className={CHECK} checked={d.isPrimary} onChange={(e) => onDetails({ isPrimary: e.target.checked })} />Primary contact</label>
          </div>
        )}
      </div>

      {duplicates.length > 0 && !data.allowDuplicate && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />This person may already be in your recipients</p>
          <ul className="mt-3 space-y-2">
            {duplicates.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                <span><b className="font-semibold">{m.name}</b><span className="text-slate-500"> · {[m.mobileNumber ? mobileText(m.mobileNumber) : "", m.email, m.city].filter(Boolean).join(" · ") || "No contact details"}</span></span>
                <span className="flex flex-wrap gap-1">{m.reasons.map((r) => <span key={r} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{REASON[r] ?? r}</span>)}</span>
              </li>
            ))}
          </ul>
          {sameMobile
            ? <p className="mt-3 text-xs text-amber-800">Two people of one client can&apos;t share a mobile number.</p>
            : <Button type="button" variant="secondary" className={cn(SMALL, "mt-3")} onClick={onConfirmDifferent}>This is a different person — continue</Button>}
          <p className="mt-2 text-xs text-amber-800">To avoid duplicates, cancel and open the existing recipient instead.</p>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------------------- step 2: occasions
const blankOccasion = (): Occasion => ({ key: newKey(), type: "Birthday", name: "", date: "", repeatAnnually: true, notes: "" });
export type OccasionsHandle = { trySave: () => boolean };

export const OccasionsStep = forwardRef<OccasionsHandle, { items: Occasion[]; editing: boolean; onChange: (items: Occasion[]) => void }>(
  function OccasionsStep({ items, editing, onChange }, ref) {
    const [draft, setDraft] = useState<Occasion | null>(null);
    const [errors, setErrors] = useState<Errors>({});
    const updating = !!draft && items.some((i) => i.key === draft.key);
    const save = () => {
      if (!draft) return true;
      const found = validateOccasion(draft, items);
      setErrors(found);
      if (Object.keys(found).length) return false;
      onChange(updating ? items.map((i) => (i.key === draft.key ? draft : i)) : [...items, draft]);
      setDraft(null);
      return true;
    };
    useImperativeHandle(ref, () => ({ trySave: save }));
    return (
      <>
        {editing && <p className="mb-3 rounded-xl bg-slate-50 px-4 py-2.5 text-xs text-slate-500">Birthday and anniversary are changed here. This person&apos;s other events are on the Events page.</p>}
        <div className="space-y-2.5">
          {items.map((item) => (
            <div key={item.key} className={cn(BOX, "flex flex-wrap items-center justify-between gap-3")}>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{occasionLabel(item)} <span className="font-normal text-slate-500">· {day(item.date)}{item.repeatAnnually ? " · every year" : ""}</span></p>
                {item.notes && <p className="mt-0.5 truncate text-xs text-slate-500">{item.notes}</p>}
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" className={SMALL} aria-label={`Edit ${occasionLabel(item)}`} onClick={() => { setErrors({}); setDraft(item); }}><Pencil className="h-4 w-4" /></Button>
                <Button type="button" variant="ghost" className={cn(SMALL, "text-red-600 hover:bg-red-50")} aria-label={`Remove ${occasionLabel(item)}`} onClick={() => onChange(items.filter((o) => o.key !== item.key))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          {!items.length && !draft && <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">No occasions added yet.</p>}
        </div>
        {draft ? (
          <div className="mt-4 grid gap-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-4 sm:grid-cols-2">
            <SelectField label="Occasion type" value={draft.type} error={errors.type} options={OCCASION_TYPES.map((t) => ({ value: t, label: t }))}
              onChange={(e) => setDraft({ ...draft, type: e.target.value, repeatAnnually: e.target.value !== "Custom" ? true : draft.repeatAnnually })} />
            {draft.type === "Custom" && <InputField label="Occasion name" required maxLength={150} value={draft.name} error={errors.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
            <DatePicker label="Date" required value={draft.date} error={errors.date} onChange={(date) => setDraft({ ...draft, date })} max={draft.type === "Birthday" ? todayIso() : undefined} />
            <label className="flex min-h-9 items-center gap-2 self-end text-sm"><input type="checkbox" className={CHECK} checked={draft.repeatAnnually} onChange={(e) => setDraft({ ...draft, repeatAnnually: e.target.checked })} />Repeat every year</label>
            <div className="sm:col-span-2"><InputField label="Notes" maxLength={2000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
            <div className="flex gap-2 sm:col-span-2"><Button type="button" onClick={save}>{updating ? "Update occasion" : "Add occasion"}</Button><Button type="button" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button></div>
          </div>
        ) : <Button type="button" className="mt-4" variant="secondary" onClick={() => { setErrors({}); setDraft(blankOccasion()); }}><Plus className="h-4 w-4" />Add occasion</Button>}
      </>
    );
  },
);

// --------------------------------------------------------------------------------------------- step 3: preferences, delivery
function TagInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text.split(",").map((p) => p.trim().slice(0, 60)).filter(Boolean);
    if (parts.length) onChange([...new Set([...values, ...parts])].slice(0, 30));
    setText("");
  };
  return (
    <div className="space-y-1.5">
      <InputField label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
      {values.length > 0 && <div className="flex flex-wrap gap-1.5">{values.map((v) => <span key={v} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-3 pr-1.5 text-sm">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><X className="h-3.5 w-3.5 text-slate-500" /></button></span>)}</div>}
    </div>
  );
}

export function PreferencesFields({ prefs, onChange }: { prefs: Preferences; onChange: (p: Partial<Preferences>) => void }) {
  const area = (label: string, key: "giftPreferences" | "dietary" | "avoid" | "instructions", max: number) => (
    <TextareaField label={label} rows={3} maxLength={max} value={prefs[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TagInput label="Interests and hobbies" values={prefs.interests} onChange={(interests) => onChange({ interests })} />
      <TagInput label="Preferred brands" values={prefs.brands} onChange={(brands) => onChange({ brands })} />
      {area("Gift preferences", "giftPreferences", 2000)}
      {area("Dietary preferences", "dietary", 1000)}
      {area("Gifts to avoid", "avoid", 1000)}
      {area("Special instructions", "instructions", 2000)}
    </div>
  );
}

function AddressFields({ value, errors, prefix, onChange }: { value: Address; errors: Errors; prefix: string; onChange: (a: Address) => void }) {
  const field = (key: "line1" | "line2" | "city" | "state" | "postalCode") => ({ value: value[key], error: errors[`${prefix}.${key}`], onChange: (e: { target: { value: string } }) => onChange({ ...value, [key]: e.target.value }) });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><InputField label="Address" maxLength={300} {...field("line1")} /></div>
      <div className="sm:col-span-2"><InputField label="Address line 2" maxLength={300} {...field("line2")} /></div>
      <InputField label="City" maxLength={100} {...field("city")} />
      <InputField label="State" maxLength={100} {...field("state")} />
      <InputField label="PIN code" inputMode="numeric" maxLength={6} {...field("postalCode")} />
    </div>
  );
}

export function AddressSection({ data, errors, onChange }: { data: WizardData; errors: Errors; onChange: (p: Partial<WizardData>) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-base font-semibold">Permanent address</h3>
        <AddressFields value={data.permanent} errors={errors} prefix="permanent" onChange={(permanent) => onChange({ permanent })} />
      </div>
      <div>
        <h3 className="text-base font-semibold">Current address</h3>
        <label className="mb-3 mt-2 flex min-h-9 cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" className={CHECK} checked={data.sameAddress} onChange={(e) => onChange({ sameAddress: e.target.checked })} />Same as permanent address</label>
        {data.sameAddress
          ? <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Gifts will be delivered to the permanent address.</p>
          : <AddressFields value={data.current} errors={errors} prefix="current" onChange={(current) => onChange({ current })} />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------- step 4: review
const none = <span className="text-slate-400">Not added</span>;
function Section({ title, step, onEdit, children }: { title: string; step: number; onEdit: (s: number) => void; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button type="button" onClick={() => onEdit(step)} className="pressable inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 px-3 text-xs font-semibold text-brand hover:bg-brand-soft"><Pencil className="h-3.5 w-3.5" />Edit</button>
      </div>
      {children}
    </section>
  );
}
function Rows({ items }: { items: [string, ReactNode][] }) {
  return <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>)}</dl>;
}

export function ReviewStep({ data, groups, photoUrl, showPreferences, onEdit }: { data: WizardData; groups: GroupRef[]; photoUrl: string | null; showPreferences: boolean; onEdit: (s: number) => void }) {
  const d = data.details, p = data.preferences;
  const names = [...data.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? ""), data.newGroupName.trim() ? `${data.newGroupName.trim()} (new)` : ""].filter(Boolean);
  const addresses = [data.permanent, data.sameAddress ? null : data.current].filter((a): a is Address => !!a && !!a.line1.trim());
  const relationship = RELATIONSHIPS.find((r) => r.value === d.relationship)?.label;
  return (
    <div className="space-y-4">
      <Section title="Recipient details" step={0} onEdit={onEdit}>
        <div className="flex items-start gap-4">
          <Avatar name={d.name} src={photoUrl} size="md" />
          <div className="min-w-0 flex-1">
            <Rows items={[
              ["Full name", <b key="n" className="font-semibold">{d.name.trim()}</b>], ["Recipient type", d.recipientType === "EXTERNAL" ? "External" : "Internal"],
              ["Mobile", d.mobile.trim() || none], ["Group", names.length ? names.join(", ") : none], ["Email", d.email.trim() || none], ["Company", d.company.trim() || none],
              ["Relationship", relationship ?? none], ["Designation", d.designation.trim() || none], ["City", d.city.trim() || none], ["Budget", d.budget.trim() ? `₹${d.budget}` : none],
            ]} />
          </div>
        </div>
      </Section>
      <Section title="Occasions" step={1} onEdit={onEdit}>
        {data.occasions.length ? (
          <ul className="space-y-2 text-sm">{data.occasions.map((o) => <li key={o.key}><b className="font-semibold">{occasionLabel(o)}</b> {day(o.date)} <span className="text-slate-500">{[o.repeatAnnually ? "Repeats every year" : "One time", o.notes.trim()].filter(Boolean).join(" · ")}</span></li>)}</ul>
        ) : <p className="text-sm">{none}</p>}
      </Section>
      {showPreferences && (
        <Section title="Preferences" step={2} onEdit={onEdit}>
          <Rows items={[["Interests", p.interests.join(", ") || none], ["Preferred brands", p.brands.join(", ") || none], ["Gift preferences", p.giftPreferences.trim() || none], ["Dietary preferences", p.dietary.trim() || none], ["Gifts to avoid", p.avoid.trim() || none], ["Special instructions", p.instructions.trim() || none]]} />
        </Section>
      )}
      <Section title="Delivery addresses" step={2} onEdit={onEdit}>
        {addresses.length ? (
          <ul className="space-y-2 text-sm">{addresses.map((a) => <li key={a.label}><b className="font-semibold">{a.label === "PERMANENT" ? "Permanent address" : "Current address"}</b> {[a.line1, a.line2, a.city, a.state, a.postalCode].filter((x) => x.trim()).join(", ")}</li>)}</ul>
        ) : <p className="text-sm">{none}</p>}
        {data.sameAddress && <p className="mt-2 text-sm text-slate-500">Current address: same as permanent address.</p>}
      </Section>
    </div>
  );
}
