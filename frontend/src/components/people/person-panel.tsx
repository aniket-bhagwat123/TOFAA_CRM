"use client";
import { Camera, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Spinner } from "@/components/ui/spinner";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { HistoryEntry, Person, PersonAddress, PersonLink, PersonPreferences } from "@/types/people";
import { ACTIONS, ADDRESS_LABELS, LINK_TYPES, mobileText, relationshipOf } from "./labels";

type Tab = "details" | "addresses" | "preferences" | "relationships" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "details", label: "Details" }, { key: "addresses", label: "Addresses" }, { key: "preferences", label: "Preferences" },
  { key: "relationships", label: "Relationships" }, { key: "history", label: "History" },
];

type Props = { personId: string | null; onClose: () => void; onEdit: (p: Person) => void; onChanged: () => void };

/** A person's profile in a side panel: photo, completeness, details, addresses, preferences, links and history. */
export function PersonPanel({ personId, onClose, onEdit, onChanged }: Props) {
  const person = useApi<Person>(personId ? `/people/${personId}` : null);
  const [tab, setTab] = useState<Tab>("details");
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (personId) setTab("details"); }, [personId]);
  useEffect(() => {
    if (!personId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [personId, onClose]);

  if (!personId) return null;
  const p = person.data?.id === personId ? person.data : null;
  const refresh = () => { void person.reload(); onChanged(); };

  async function photo(file: File | null, remove = false) {
    setBusy(true);
    try {
      if (remove) await apiClient.delete(`/people/${personId}/photo`);
      else if (file) { const form = new FormData(); form.append("file", file); await apiClient.put(`/people/${personId}/photo`, form); }
      toast.success(remove ? "Photo removed" : "Photo saved");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const rel = relationshipOf(p?.relationship);
  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-label={p?.name ?? "Person"} className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-sheet">
        <header className="flex items-start gap-3 border-b border-slate-100 p-4">
          <div className="relative shrink-0">
            <Avatar src={p?.photoUrl} name={p?.name} size="lg" />
            <button type="button" aria-label="Change photo" disabled={!p || busy} onClick={() => fileRef.current?.click()}
              className="pressable absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-brand text-white disabled:opacity-50"><Camera className="h-3.5 w-3.5" /></button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { void photo(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900">{p?.name ?? " "}</h2>
            <p className="truncate text-xs text-slate-500">{[p?.designation, p?.account?.name].filter(Boolean).join(" · ")}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {rel && <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", rel.tone)}>{rel.label}</span>}
              {p?.status === "ARCHIVED" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-600">Archived</span>}
              {p?.photoUrl && <button type="button" onClick={() => void photo(null, true)} className="text-[12px] font-medium text-slate-500 hover:text-red-600">Remove photo</button>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {p && <Button variant="secondary" className="min-h-8 px-2.5 text-xs" onClick={() => onEdit(p)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            <button type="button" aria-label="Close" onClick={onClose} className="pressable rounded-full p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </header>

        {p && <Completeness p={p} />}

        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 text-sm font-medium", tab === t.key ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-800")}>{t.label}</button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!p ? <div className="flex justify-center py-16"><Spinner /></div>
            : tab === "details" ? <Details p={p} />
            : tab === "addresses" ? <Addresses id={p.id} onChanged={refresh} />
            : tab === "preferences" ? <Preferences id={p.id} onChanged={refresh} />
            : tab === "relationships" ? <Links p={p} onChanged={refresh} />
            : <History id={p.id} />}
        </div>
      </aside>
    </div>
  );
}

function Completeness({ p }: { p: Person }) {
  const c = p.completeness;
  const missing = c.sections.flatMap((s) => s.missing);
  return (
    <div className="space-y-1.5 border-b border-slate-100 px-4 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-600">Profile {c.percent}% complete</span>
        {missing.length > 0 && <span className="text-slate-400">Missing: {missing.join(", ")}</span>}
      </div>
      <div className="h-1.5 rounded-full bg-slate-100"><div className={cn("h-full rounded-full", c.needsAttention ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${c.percent}%` }} /></div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2 py-1.5 text-sm"><dt className="text-slate-500">{label}</dt><dd className="min-w-0 break-words text-slate-800">{children || <span className="text-slate-300">—</span>}</dd></div>
);

function Details({ p }: { p: Person }) {
  const money = (v?: number | string | null) => (v != null && v !== "" ? inr(Number(v)) : null);
  return (
    <dl className="divide-y divide-slate-50">
      <Row label="Mobile">{mobileText(p.mobileNumber)}</Row>
      <Row label="Email">{p.email}</Row>
      <Row label="Designation">{p.designation}</Row>
      <Row label="Department">{p.department}</Row>
      <Row label="City">{p.city}</Row>
      <Row label="Type">{p.recipientType === "EXTERNAL" ? `External${p.companyName ? ` · ${p.companyName}` : ""}` : "Internal"}</Row>
      <Row label="Date of birth">{p.dateOfBirth ? formatDate(p.dateOfBirth) : null}</Row>
      <Row label="Anniversary">{p.anniversaryDate ? formatDate(p.anniversaryDate) : null}</Row>
      <Row label="Next occasion">{p.nextOccasion ? `${p.nextOccasion.label} · ${formatDate(p.nextOccasion.date)} (${p.nextOccasion.daysAway === 0 ? "today" : `in ${p.nextOccasion.daysAway} days`})` : null}</Row>
      <Row label="Gifting occasion">{p.giftingOccasion}</Row>
      <Row label="Budget">{money(p.budget)}</Row>
      <Row label="Birthday budget">{money(p.birthdayBudget)}</Row>
      <Row label="Anniversary budget">{money(p.anniversaryBudget)}</Row>
      <Row label="Groups">{p.groups.map((g) => g.name).join(", ")}</Row>
      <Row label="Remark">{p.remark}</Row>
      <Row label="Added">{`${formatDate(p.createdAt)}${p.source === "IMPORT" ? " (imported)" : ""}`}</Row>
    </dl>
  );
}

// --- addresses --------------------------------------------------------------------------------------------------------

const BLANK = { label: "OFFICE", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", isDefault: false };

function Addresses({ id, onChanged }: { id: string; onChanged: () => void }) {
  const list = useApi<PersonAddress[]>(`/people/${id}/addresses`);
  const [editing, setEditing] = useState<PersonAddress | "new" | null>(null);
  const [f, setF] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const reload = () => { void list.reload(); onChanged(); };

  const open = (a: PersonAddress | "new") => {
    setEditing(a); setErrors({});
    setF(a === "new" ? BLANK : { label: a.label, addressLine1: a.addressLine1, addressLine2: a.addressLine2 ?? "", city: a.city, state: a.state ?? "", postalCode: a.postalCode, isDefault: a.isDefault });
  };
  async function save() {
    const e: Record<string, string> = {};
    if (f.addressLine1.trim().length < 3) e.addressLine1 = "Enter the address";
    if (!f.city.trim()) e.city = "Enter the city";
    if (!/^\d{6}$/.test(f.postalCode.trim())) e.postalCode = "Enter the 6-digit PIN";
    if (Object.keys(e).length) return setErrors(e);
    setBusy(true);
    const body = { label: f.label, addressLine1: f.addressLine1.trim(), addressLine2: f.addressLine2.trim() || null, city: f.city.trim(), state: f.state.trim() || null, postalCode: f.postalCode.trim(), isDefault: f.isDefault };
    try {
      if (editing === "new") await apiClient.post(`/people/${id}/addresses`, { ...body, country: "IN" });
      else if (editing) await apiClient.patch(`/people/${id}/addresses/${editing.id}`, body);
      toast.success("Address saved");
      setEditing(null);
      reload();
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe); else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function act(fn: () => Promise<unknown>, done: string) {
    try { await fn(); toast.success(done); reload(); } catch (err) { toast.error(errorMessage(err)); }
  }

  if (editing) {
    const field = (k: keyof typeof BLANK) => ({ value: String(f[k]), onChange: (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: "" })); }, error: errors[k] });
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Type" value={f.label} onChange={(e) => setF((x) => ({ ...x, label: e.target.value }))} options={ADDRESS_LABELS} />
          <InputField label="PIN code" required inputMode="numeric" maxLength={6} {...field("postalCode")} />
        </div>
        <InputField label="Address line 1" required {...field("addressLine1")} />
        <InputField label="Address line 2" {...field("addressLine2")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="City" required {...field("city")} />
          <InputField label="State" {...field("state")} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.isDefault} onChange={(e) => setF((x) => ({ ...x, isDefault: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-brand" />Default delivery address</label>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void save()} loading={busy}>Save address</Button></div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {list.loading && !list.data && <div className="flex justify-center py-8"><Spinner /></div>}
      {list.data?.length === 0 && <p className="py-4 text-sm text-slate-500">No delivery address yet.</p>}
      {list.data?.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {ADDRESS_LABELS.find((l) => l.value === a.label)?.label}{a.isDefault && <span className="rounded bg-emerald-50 px-1.5 py-px text-[11px] text-emerald-700">Default</span>}
            </div>
            <p className="text-slate-800">{[a.addressLine1, a.addressLine2, a.city, a.state, a.postalCode].filter(Boolean).join(", ")}</p>
          </div>
          {!a.isDefault && <button type="button" title="Make default" aria-label="Make default" onClick={() => void act(() => apiClient.patch(`/people/${id}/addresses/${a.id}`, { isDefault: true }), "Default address set")} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-amber-600"><Star className="h-4 w-4" /></button>}
          <button type="button" aria-label="Edit address" onClick={() => open(a)} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
          <button type="button" aria-label="Remove address" onClick={() => void act(() => apiClient.delete(`/people/${id}/addresses/${a.id}`), "Address removed")} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <Button variant="secondary" className="w-full" onClick={() => open("new")}><Plus className="h-4 w-4" />Add address</Button>
    </div>
  );
}

// --- preferences ------------------------------------------------------------------------------------------------------

const splitTags = (v: string) => v.split(",").map((t) => t.trim()).filter(Boolean);

function Preferences({ id, onChanged }: { id: string; onChanged: () => void }) {
  const pref = useApi<PersonPreferences>(`/people/${id}/preferences`);
  const [f, setF] = useState({ interests: "", preferredBrands: "", giftPreferences: "", dietaryPreferences: "", giftsToAvoid: "", specialInstructions: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = pref.data;
    if (d) setF({ interests: d.interests.join(", "), preferredBrands: d.preferredBrands.join(", "), giftPreferences: d.giftPreferences ?? "", dietaryPreferences: d.dietaryPreferences ?? "", giftsToAvoid: d.giftsToAvoid ?? "", specialInstructions: d.specialInstructions ?? "" });
  }, [pref.data]);
  if (pref.loading && !pref.data) return <div className="flex justify-center py-8"><Spinner /></div>;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setBusy(true);
    try {
      await apiClient.put(`/people/${id}/preferences`, {
        interests: splitTags(f.interests), preferredBrands: splitTags(f.preferredBrands), giftPreferences: f.giftPreferences.trim() || null,
        dietaryPreferences: f.dietaryPreferences.trim() || null, giftsToAvoid: f.giftsToAvoid.trim() || null, specialInstructions: f.specialInstructions.trim() || null,
      });
      toast.success("Preferences saved");
      void pref.reload(); onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <InputField label="Interests (comma separated)" placeholder="Tea, books, travel" value={f.interests} onChange={set("interests")} />
      <InputField label="Preferred brands (comma separated)" value={f.preferredBrands} onChange={set("preferredBrands")} />
      <TextareaField label="Gift preferences" rows={2} maxLength={2000} value={f.giftPreferences} onChange={set("giftPreferences")} />
      <TextareaField label="Dietary preferences" rows={2} maxLength={1000} value={f.dietaryPreferences} onChange={set("dietaryPreferences")} />
      <TextareaField label="Gifts to avoid" rows={2} maxLength={1000} value={f.giftsToAvoid} onChange={set("giftsToAvoid")} />
      <TextareaField label="Special instructions" rows={2} maxLength={2000} value={f.specialInstructions} onChange={set("specialInstructions")} />
      <Button onClick={() => void save()} loading={busy} className="w-full">Save preferences</Button>
    </div>
  );
}

// --- relationships ----------------------------------------------------------------------------------------------------

function Links({ p, onChanged }: { p: Person; onChanged: () => void }) {
  const links = useApi<PersonLink[]>(`/people/${p.id}/relationships`);
  const [q, setQ] = useState("");
  const found = useApi<{ items: Person[] }>(q.trim().length >= 2 ? "/people" : null, { companyId: p.companyId, search: q.trim(), limit: 8, status: "ALL" });
  const [items, setItems] = useState<{ relatedRecipientId: string; relationshipType: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems((links.data ?? []).filter((l) => l.related && !l.related.deletedAt).map((l) => ({ relatedRecipientId: l.relatedRecipientId, relationshipType: l.relationshipType, name: l.related!.name })));
  }, [links.data]);
  async function save() {
    setBusy(true);
    try {
      await apiClient.put(`/people/${p.id}/relationships`, { items: items.map(({ relatedRecipientId, relationshipType }) => ({ relatedRecipientId, relationshipType })) });
      toast.success("Relationships saved");
      void links.reload(); onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  const candidates = (found.data?.items ?? []).filter((x) => x.id !== p.id && !items.some((i) => i.relatedRecipientId === x.id));
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Link {p.name} to other people of {p.account?.name ?? "this client"} (a spouse, a colleague...).</p>
      {items.length === 0 && <p className="text-sm text-slate-400">No relationships yet.</p>}
      {items.map((it, i) => (
        <div key={it.relatedRecipientId} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{it.name}</span>
          <select aria-label={`Relationship with ${it.name}`} value={it.relationshipType} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, relationshipType: e.target.value } : y)))}
            className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs">
            {LINK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" aria-label={`Remove ${it.name}`} onClick={() => setItems((x) => x.filter((_, j) => j !== i))} className="pressable rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <InputField label="Add a person" placeholder="Search by name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      {candidates.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {candidates.map((c) => (
            <li key={c.id}><button type="button" onClick={() => { setItems((x) => [...x, { relatedRecipientId: c.id, relationshipType: "COLLEAGUE", name: c.name }]); setQ(""); }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"><span>{c.name}</span><span className="text-xs text-slate-400">{mobileText(c.mobileNumber)}</span></button></li>
          ))}
        </ul>
      )}
      <Button onClick={() => void save()} loading={busy} className="w-full">Save relationships</Button>
    </div>
  );
}

// --- history ----------------------------------------------------------------------------------------------------------

function History({ id }: { id: string }) {
  const h = useApi<{ items: HistoryEntry[] }>(`/people/${id}/history`);
  if (h.loading && !h.data) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (!h.data?.items.length) return <p className="text-sm text-slate-500">No changes recorded yet.</p>;
  const show = (v: unknown) => (v == null || v === "" ? "empty" : String(v));
  return (
    <ol className="space-y-2.5">
      {h.data.items.map((e) => (
        <li key={e.id} className="rounded-xl border border-slate-100 p-2.5 text-sm">
          <div className="text-slate-800">
            <b className="font-semibold">{ACTIONS[e.action] ?? e.action}</b>
            {e.field && <> · {e.field.replace(/_/g, " ")}: <span className="text-slate-500">{show(e.oldValue)}</span> → <span>{show(e.newValue)}</span></>}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-400">{e.actorName ?? "Someone"} · {formatDateTime(e.createdAt)}{e.source === "IMPORT" ? " · import" : ""}</div>
        </li>
      ))}
    </ol>
  );
}
