"use client";
/**
 * New gift request: Gifting OS's three steps (Basic Details, Gift Preferences, Additional Details) with its request
 * summary and checks, in the CRM's colours. The CRM sends the finished request to TOFAA (it keeps no drafts).
 */
import { ArrowLeft, ArrowRight, Check, CheckCircle2, FileText, Gift, Lightbulb, Plus, ShieldCheck, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { todayIso } from "@/lib/format";
import { pickedClient } from "@/lib/selected-client";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { PlanningOptions } from "@/types/gifting";
import type { PeopleList, Person, PersonAddress } from "@/types/people";
import { budgetLabel, day, GIFT_PURPOSES, GIFT_STYLES, INITIATED_VIA, INTERESTS, labelFrom, parseBudget, RELATIONSHIP_OPTIONS, shortDay } from "./shared";

type Style = "PREMIUM" | "THOUGHTFUL" | "PERSONALISED";
type Form = {
  companyId: string; recipientId: string; source: string; deliveryDate: string; budgetMode: "SPECIFIC" | "TOFAA_RECOMMEND"; budget: string; initiatedVia: string;
  relationship: string; relationshipContext: string; interests: string[]; giftStyle: Style | ""; specialInstructions: string;
  deliveryAddress: string | null; message: string; giftPurpose: string;
};
type Errors = Partial<Record<"companyId" | "recipientId" | "source" | "deliveryDate" | "budget" | "initiatedVia" | "relationship", string>>;
const EMPTY: Form = {
  companyId: "", recipientId: "", source: "", deliveryDate: "", budgetMode: "SPECIFIC", budget: "", initiatedVia: "", relationship: "",
  relationshipContext: "", interests: [], giftStyle: "", specialInstructions: "", deliveryAddress: null, message: "", giftPurpose: "",
};
const STEPS = [
  { title: "Basic Details", hint: "Recipient, occasion & budget" },
  { title: "Gift Preferences", hint: "Your preferences" },
  { title: "Additional Details", hint: "Address, message & more" },
];
const addressText = (a?: PersonAddress) => (a ? [a.addressLine1, a.addressLine2, [a.city, a.postalCode].filter(Boolean).join(" – "), a.state].filter(Boolean).join(", ") : "");

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-brand-soft/30 p-5"><div><h3 className="text-base font-semibold text-slate-900">{title}</h3><p className="text-sm text-slate-500">{subtitle}</p></div>{children}</section>;
}
function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <aside aria-label="Request summary" className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-brand-soft/30">
        <h3 className="flex items-center gap-2 border-b border-slate-200 px-5 py-3 text-base font-semibold"><FileText className="h-4 w-4 text-brand" />Request Summary</h3>
        <dl className="space-y-3 p-5">{rows.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="break-words text-sm font-semibold text-slate-900">{value || "—"}</dd></div>)}</dl>
      </div>
      <p className="flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900"><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><span><strong>Tip:</strong> Check the details: TOFAA starts curating options as soon as you submit.</span></p>
    </aside>
  );
}

/** What the Gift Calendar already knows when a request is started from one of its dates. */
export type RequestStart = { companyId?: string; recipientId?: string; recipientName?: string; source?: string; deliveryDate?: string };

export function RequestWizard({ start, onClose, onCreated }: { start?: RequestStart; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setFormState] = useState<Form>(() => ({
    ...EMPTY, companyId: start?.companyId ?? "", recipientId: start?.recipientId ?? "", source: start?.source ?? "", deliveryDate: start?.deliveryDate ?? "",
  }));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [search, setSearch] = useState(start?.recipientName ?? "");
  const [person, setPerson] = useState<Person | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState<{ id: string; requestCode?: string } | null>(null);
  const q = useDebounce(search, 300);

  const set = (patch: Partial<Form>) => { setFormState((c) => ({ ...c, ...patch })); setDirty(true); setErrors({}); };
  const accounts = useApi<{ id: string; name: string }[]>("/gifting-planning/accounts");
  const picked = pickedClient()?.id; // with a client picked in the header, a request is raised for that client only
  const only = start?.companyId ?? picked; // the client asked about (or in view) before this opened
  const clients = useMemo(() => (accounts.data ?? []).filter((a) => !only || a.id === only), [accounts.data, only]);
  useEffect(() => { if (!form.companyId && clients.length === 1) setFormState((c) => ({ ...c, companyId: clients[0].id })); }, [clients, form.companyId]);

  const people = useApi<PeopleList>(form.companyId ? "/people" : null, { companyId: form.companyId, search: q || undefined, limit: 50, sort: "name" });
  const options = useApi<PlanningOptions>(form.companyId ? "/gifting-planning/options" : null, { companyId: form.companyId, recipientId: form.recipientId || undefined });
  useEffect(() => { // the person named by the calendar, once the list has them
    const found = !person && people.data?.items.find((p) => p.id === form.recipientId);
    if (found) setPerson(found);
  }, [people.data, person, form.recipientId]);
  const addresses = useApi<PersonAddress[]>(form.recipientId ? `/people/${form.recipientId}/addresses` : null);
  const saved = addressText(addresses.data?.find((a) => a.isDefault) ?? addresses.data?.[0]);
  const address = form.deliveryAddress ?? saved;

  const sources = [
    ...(options.data?.occasions ?? []).map((o) => ({ value: `occasion:${o.id}`, label: `${o.name}${o.date ? ` · ${shortDay(o.date)}` : ""}`, name: o.name })),
    ...(options.data?.events ?? []).map((e) => ({ value: `event:${e.id}`, label: `${e.name}${e.date ? ` · ${shortDay(e.date)}` : ""}`, name: e.name })),
  ];
  const sourceName = sources.find((s) => s.value === form.source)?.name ?? "";
  const budget = parseBudget(form.budget);
  const range = budget && budget !== "invalid" && form.budgetMode === "SPECIFIC" ? budget : null;
  const budgetSummary = form.budgetMode === "TOFAA_RECOMMEND" ? "TOFAA to recommend" : range ? budgetLabel({ budgetMode: "SPECIFIC", budgetMin: range.min, budgetMax: range.max }) : "";
  const peopleList = [...(person && !people.data?.items.some((p) => p.id === person.id) ? [person] : []), ...(people.data?.items ?? [])];

  function check(target: number): Errors {
    const next: Errors = {};
    if (target === 0) {
      if (!form.companyId) next.companyId = "Please choose the client.";
      if (!form.recipientId) next.recipientId = "Please choose who the gift is for.";
      if (!form.source) next.source = "Please choose an occasion or event.";
      if (!form.deliveryDate) next.deliveryDate = "Please pick the required delivery date.";
      else if (form.deliveryDate < todayIso()) next.deliveryDate = "The delivery date can't be in the past.";
      if (form.budgetMode === "SPECIFIC") {
        if (!form.budget.trim()) next.budget = "Enter a budget, or let TOFAA recommend one.";
        else if (budget === "invalid") next.budget = "Enter an amount like 50,000 or a range like 3,00,000 – 5,00,000.";
      }
      if (!form.initiatedVia) next.initiatedVia = "Tell us how this gift was initiated.";
    }
    if (target === 1 && !form.relationship) next.relationship = "Please choose your relationship with the recipient.";
    return next;
  }
  /** Moves forward only past steps that are complete; shows the first problem. */
  function go(target: number) {
    for (let i = step; i < target; i++) { const found = check(i); if (Object.keys(found).length) { setStep(i); setErrors(found); return; } }
    setErrors({}); setStep(target);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (step < 2) return go(step + 1);
    for (const i of [0, 1]) { const found = check(i); if (Object.keys(found).length) { setStep(i); setErrors(found); return; } }
    setBusy(true);
    try {
      const [kind, id] = form.source.split(":");
      const name = sourceName || "Gift";
      const res = await apiClient.post<{ id: string; requestCode?: string }>("/gifting-planning/requests", {
        companyId: form.companyId, recipientId: form.recipientId, occasionId: kind === "occasion" ? id : null, eventId: kind === "event" ? id : null,
        title: `${name} gift${person ? ` for ${person.name}` : ""}`.slice(0, 180),
        purpose: form.giftPurpose ? `${labelFrom(GIFT_PURPOSES, form.giftPurpose)} gift for ${name.toLowerCase()}` : `A thoughtful gift for ${name.toLowerCase()}`,
        deliveryDate: form.deliveryDate, budgetMode: form.budgetMode, budgetMin: range?.min ?? null, budgetMax: range?.max ?? null,
        initiatedVia: form.initiatedVia, relationship: form.relationship, relationshipContext: form.relationshipContext.trim() || null,
        interests: form.interests, giftStyle: form.giftStyle || null, deliveryAddress: address.trim() || null,
        message: form.message.trim() || null, giftPurpose: form.giftPurpose || null, specialInstructions: form.specialInstructions.trim() || null,
      });
      setDone(res.data); setDirty(false);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  const close = () => { if (busy) return; if (done) return onCreated(done.id); if (dirty) setLeaving(true); else onClose(); };
  const addInterest = () => {
    const text = custom.trim();
    if (text && !form.interests.some((i) => i.toLowerCase() === text.toLowerCase())) set({ interests: [...form.interests, text].slice(0, 12) });
    setCustom("");
  };
  const basics: [string, string][] = [["Recipient", person?.name ?? ""], ["Occasion", sourceName], ["Delivery date", form.deliveryDate ? day(form.deliveryDate) : ""], ["Budget range", budgetSummary], ["Initiated by", labelFrom(INITIATED_VIA, form.initiatedVia)]];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="New gift request" className="animate-rise flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-sheet sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
        <header className="flex items-start gap-3 px-5 pb-3 pt-5 sm:px-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Gift className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold text-slate-900">New gift request</h2><p className="text-sm text-slate-500">Share a few details. TOFAA will curate thoughtful gift options.</p></div>
          <button type="button" aria-label="Close" onClick={close} className="pressable rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </header>

        {done ? (
          <div className="overflow-y-auto px-5 pb-8 text-center sm:px-8">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-8 w-8" /></span>
            <h3 className="mt-4 text-xl font-semibold">Gift request submitted</h3>
            <p className="mt-1 text-sm text-slate-500">TOFAA has received the request and will start curating options.</p>
            {done.requestCode && <p className="mx-auto mt-4 inline-block rounded-full bg-brand-soft px-5 py-2 text-base font-bold text-brand">#{done.requestCode}</p>}
            <div className="mt-6 flex justify-center gap-3"><Button variant="secondary" onClick={() => onCreated(done.id)}>View request</Button><Button onClick={onClose}><Check className="h-4 w-4" />Done</Button></div>
          </div>
        ) : (
          <form noValidate onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col">
            <ol aria-label="Progress" className="grid grid-cols-3 gap-2 border-y border-slate-200 px-5 py-3 sm:px-8">
              {STEPS.map((s, i) => (
                <li key={s.title} aria-current={i === step ? "step" : undefined}>
                  <button type="button" onClick={() => go(i)} className="flex w-full items-center gap-3 text-left">
                    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", i <= step ? "bg-brand text-white" : "border border-slate-300 bg-white text-slate-500", i === step && "ring-4 ring-brand/15")}>{i < step ? <Check className="h-4 w-4" /> : i + 1}</span>
                    <span className="hidden min-w-0 sm:block"><span className={cn("block truncate text-sm font-semibold", i <= step ? "text-slate-900" : "text-slate-500")}>{s.title}</span><span className="block truncate text-xs text-slate-500">{s.hint}</span></span>
                  </button>
                </li>
              ))}
            </ol>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
              {step === 0 && (
                <div className="space-y-5">
                  <h3 className="text-lg font-semibold">1. Basic details</h3>
                  {options.data && !options.data.actionsEnabled && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">You can look, but changes from the CRM are not switched on for you.</p>}
                  <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                    {clients.length !== 1 && (
                      <div className="md:col-span-2"><SelectField label="Client" required value={form.companyId} error={errors.companyId} placeholder="Choose a client" options={clients.map((c) => ({ value: c.id, label: c.name }))}
                        onChange={(e) => { setPerson(null); set({ companyId: e.target.value, recipientId: "", source: "", deliveryAddress: null }); }} /></div>
                    )}
                    <div className="space-y-2">
                      <InputField label="Search recipient" value={search} onChange={(e) => setSearch(e.target.value)} disabled={!form.companyId} />
                      <SelectField label="Who is it for?" required value={form.recipientId} error={errors.recipientId} placeholder={form.companyId ? "Select a recipient" : "Choose the client first"}
                        options={peopleList.map((p) => ({ value: p.id, label: `${p.name}${p.city ? ` · ${p.city}` : ""}` }))}
                        onChange={(e) => { setPerson(peopleList.find((p) => p.id === e.target.value) ?? null); set({ recipientId: e.target.value, source: form.source.startsWith("event:") ? "" : form.source, deliveryAddress: null }); }} />
                      <Link href="/people" target="_blank" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"><Plus className="h-3.5 w-3.5" />Add new recipient</Link>
                    </div>
                    <div><SelectField label="Occasion or event" required value={form.source} error={errors.source} placeholder="Select an occasion or event" options={sources} onChange={(e) => set({ source: e.target.value })} /></div>
                    <DatePicker label="Required delivery date" required min={todayIso()} value={form.deliveryDate} error={errors.deliveryDate} onChange={(deliveryDate) => set({ deliveryDate })} />
                    <div className="space-y-2">
                      <InputField label="Gift budget (₹)" required={form.budgetMode === "SPECIFIC"} inputMode="decimal" disabled={form.budgetMode === "TOFAA_RECOMMEND"} value={form.budget} error={errors.budget}
                        placeholder={form.budgetMode === "TOFAA_RECOMMEND" ? "TOFAA will recommend a budget" : "e.g. 3,000 – 5,000"} onChange={(e) => set({ budget: e.target.value })} />
                    </div>
                  </div>
                  <fieldset className="grid gap-3 rounded-2xl border border-slate-200 bg-brand-soft/30 p-5 md:grid-cols-[1fr_auto] md:items-center">
                    <legend className="sr-only">Budget preference</legend>
                    <div><p className="font-semibold text-slate-900">Budget preference</p><p className="text-sm text-slate-500">Set a specific budget, or let TOFAA suggest the right value for the occasion and relationship.</p></div>
                    <div className="space-y-2">{([["SPECIFIC", "I have a budget"], ["TOFAA_RECOMMEND", "Let TOFAA recommend"]] as const).map(([value, label]) => <label key={value} className="flex min-h-8 cursor-pointer items-center gap-2.5 text-sm"><input type="radio" name="budgetMode" checked={form.budgetMode === value} onChange={() => set({ budgetMode: value })} className="h-4 w-4 text-brand" />{label}</label>)}</div>
                  </fieldset>
                  <div>
                    <SelectField label="How was this gift initiated?" required value={form.initiatedVia} error={errors.initiatedVia} placeholder="Select option" options={INITIATED_VIA} onChange={(e) => set({ initiatedVia: e.target.value })} />
                    <p className="mt-1 text-xs text-slate-500">This helps us understand the context and serves as a reference for the request.</p>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="space-y-5">
                    <Section title="Relationship & Context" subtitle="Help us understand the relationship for a more thoughtful gift.">
                      <div className="grid gap-4 md:grid-cols-2">
                        <SelectField label="Relationship with recipient" required value={form.relationship} error={errors.relationship} placeholder="Select relationship" options={RELATIONSHIP_OPTIONS.map((r) => ({ value: r, label: r }))} onChange={(e) => set({ relationship: e.target.value })} />
                        <InputField label="Context (optional)" maxLength={200} value={form.relationshipContext} onChange={(e) => set({ relationshipContext: e.target.value })} placeholder="e.g. Long standing partner, key client…" />
                      </div>
                    </Section>
                    <Section title="Gift Preferences" subtitle="Share any preferences or interests, if known.">
                      <div>
                        <p className="mb-2 text-sm font-medium text-slate-700">Interests / Preferences</p>
                        <div className="flex flex-wrap gap-2">
                          {[...INTERESTS, ...form.interests.filter((i) => !INTERESTS.includes(i))].map((item) => {
                            const on = form.interests.includes(item);
                            return <button key={item} type="button" aria-pressed={on} onClick={() => set({ interests: on ? form.interests.filter((v) => v !== item) : [...form.interests, item].slice(0, 12) })} className={cn("pressable flex min-h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium", on ? "border-brand bg-brand text-white" : "border-slate-200 bg-white hover:bg-slate-50")}>{item}{on && <Check className="h-3.5 w-3.5" />}</button>;
                          })}
                          <input value={custom} maxLength={40} aria-label="Other interest" placeholder="Other: type, press Enter" onChange={(e) => setCustom(e.target.value)} onBlur={addInterest} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addInterest(); } }} className="min-h-9 w-52 rounded-full border border-slate-200 bg-white px-4 text-sm outline-none focus:border-brand" />
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-sm font-medium text-slate-700">Preferred Gift Style</p>
                        <div role="radiogroup" aria-label="Preferred gift style" className="grid grid-cols-3 gap-2">
                          {GIFT_STYLES.map((s) => {
                            const on = form.giftStyle === s.value;
                            return <button key={s.value} type="button" role="radio" aria-checked={on} onClick={() => set({ giftStyle: on ? "" : s.value })} className={cn("pressable flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border bg-white text-sm font-medium", on ? "border-brand ring-2 ring-brand/30" : "border-slate-200")}><Star className="h-4 w-4 text-brand" />{s.label}</button>;
                          })}
                        </div>
                      </div>
                    </Section>
                    <Section title="Special Instructions" subtitle="Any specific instructions for TOFAA team.">
                      <div><TextareaField label="Special instructions" maxLength={500} rows={3} value={form.specialInstructions} onChange={(e) => set({ specialInstructions: e.target.value })} placeholder="e.g. Prefer a premium brand, avoid certain categories, add a personal note…" /><p className="mt-1 text-right text-xs text-slate-500">{form.specialInstructions.length} / 500</p></div>
                    </Section>
                  </div>
                  <Summary rows={basics} />
                </div>
              )}

              {step === 2 && (
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="space-y-4">
                    <Section title="Delivery Address" subtitle="Where should we deliver the gift?">
                      {!address && <p className="text-sm text-slate-500">This recipient has no address saved. Enter where the gift should go.</p>}
                      <TextareaField label="Delivery address" rows={2} maxLength={600} value={address} onChange={(e) => set({ deliveryAddress: e.target.value })} placeholder="Building, street, city and PIN code" />
                    </Section>
                    <Section title="Personal Message" subtitle="Add a personal note with the gift.">
                      <div><TextareaField label="Personal message" maxLength={300} rows={3} value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="e.g. Warm birthday wishes from the team." /><p className="mt-1 text-right text-xs text-slate-500">{form.message.length} / 300</p></div>
                    </Section>
                    <Section title="Gift Purpose" subtitle="What is the intention behind this gift?">
                      <SelectField label="Gift purpose" value={form.giftPurpose} options={[{ value: "", label: "Select purpose" }, ...GIFT_PURPOSES]} onChange={(e) => set({ giftPurpose: e.target.value })} />
                    </Section>
                    <p className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-brand-soft/30 px-5 py-4 text-sm"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" /><span><strong className="block">Compliance Note</strong><span className="text-slate-500">Gifts to certain individuals (e.g. public officials) may require additional compliance review.</span></span></p>
                  </div>
                  <Summary rows={[...basics, ["Relationship", form.relationship], ["Gift style", labelFrom(GIFT_STYLES, form.giftStyle)], ["Message", form.message.trim()]]} />
                </div>
              )}
            </div>

            <footer className="border-t border-slate-200 px-5 py-4 sm:px-8">
              {leaving ? (
                <div role="alertdialog" aria-label="Close without sending?" className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm"><b>Close without sending?</b> What you entered will be lost.</p>
                  <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setLeaving(false)}>Keep editing</Button><Button type="button" variant="danger" onClick={onClose}>Discard</Button></div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  {step === 0 ? <Button type="button" variant="ghost" onClick={close}>Cancel</Button> : <Button type="button" variant="secondary" disabled={busy} onClick={() => { setErrors({}); setStep(step - 1); }}><ArrowLeft className="h-4 w-4" />Back</Button>}
                  <Button type="submit" loading={busy} disabled={options.data?.actionsEnabled === false}>{step === 0 ? "Next" : step === 1 ? "Continue to Additional Details" : "Submit to TOFAA"}<ArrowRight className="h-4 w-4" /></Button>
                </div>
              )}
            </footer>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
