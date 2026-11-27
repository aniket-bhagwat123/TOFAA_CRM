"use client";
import { CalendarHeart, Settings2, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { EMAIL_MSG, isEmail, isPhone10, PHONE_MSG } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import type { AssignableUser, CalendarDate, ClientSummary } from "@/types/crm";
import { isManager } from "@/lib/roles";
import { useAppSelector } from "@/store/hooks";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Add a gifting occasion: a festival (its date comes from the calendar every year) or a fixed date like a company anniversary. */
export function OccasionSheet({ client, onClose, onDone }: { client: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const calendar = useApi<CalendarDate[]>(client ? "/occasion-calendar" : null);
  const festivals = [...new Set((calendar.data ?? []).map((c) => c.name))];
  const [kind, setKind] = useState<"festival" | "date">("festival");
  const [festival, setFestival] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [leadDays, setLeadDays] = useState("45");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!client) { setFestival(""); setName(""); setMonth(""); setDay(""); setLeadDays("45"); setErrors({}); } }, [client]);

  async function save() {
    if (!client) return;
    const e: Record<string, string> = {};
    if (kind === "festival" && !festival) e.festival = "Pick the festival";
    if (kind === "date") {
      if (!name.trim()) e.name = "Name the occasion";
      if (!month) e.month = "Pick the month";
      if (!(Number(day) >= 1 && Number(day) <= 31)) e.day = "Enter a day from 1 to 31";
    }
    if (!(Number(leadDays) >= 1 && Number(leadDays) <= 180)) e.leadDays = "Enter 1 to 180 days";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await apiClient.post(`/clients/${client.id}/occasions`, kind === "festival"
        ? { name: festival, fromCalendar: true, leadDays: Number(leadDays) }
        : { name: name.trim(), fromCalendar: false, month: Number(month), day: Number(day), leadDays: Number(leadDays) });
      toast.success("Occasion added. You will be reminded to call in time.");
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
    <Sheet open={!!client} title="Add occasion" subtitle={client?.name} icon={CalendarHeart} tone="indigo" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {(["festival", "date"] as const).map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); setErrors({}); }} className={cn("pressable flex-1 rounded-lg py-2 text-sm font-medium", kind === k ? "bg-white shadow-sm" : "text-slate-500")}>
              {k === "festival" ? "Festival" : "Fixed date"}
            </button>
          ))}
        </div>
        {kind === "festival" ? (
          <SelectField label="Festival" required placeholder="Choose a festival" value={festival} options={festivals.map((f) => ({ value: f, label: f }))} onChange={(e) => { setFestival(e.target.value); setErrors((x) => ({ ...x, festival: "" })); }} error={errors.festival} />
        ) : (
          <>
            <InputField label="Occasion" required placeholder="Enter occasion name" value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: "" })); }} error={errors.name} />
            <div className="grid grid-cols-2 gap-4">
              <SelectField label="Month" required placeholder="Choose" value={month} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} onChange={(e) => { setMonth(e.target.value); setErrors((x) => ({ ...x, month: "" })); }} error={errors.month} />
              <InputField label="Day" required type="number" integer value={day} onChange={(e) => { setDay(e.target.value); setErrors((x) => ({ ...x, day: "" })); }} error={errors.day} />
            </div>
          </>
        )}
        <InputField label="Remind me this many days before" type="number" integer required value={leadDays} onChange={(e) => { setLeadDays(e.target.value); setErrors((x) => ({ ...x, leadDays: "" })); }} error={errors.leadDays} />
        <p className="-mt-2 text-xs text-slate-400">Gifting orders need time to source and brand. 45 days is a good default.</p>
        <Button onClick={save} loading={busy} className="w-full">Add occasion</Button>
      </div>
    </Sheet>
  );
}

/** Another person at the client (purchase, HR, admin ...). */
export function ContactSheet({ client, onClose, onDone }: { client: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: "", designation: "", phone: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: "" })); };
  useEffect(() => { if (!client) { setV({ name: "", designation: "", phone: "", email: "" }); setErrors({}); } }, [client]);

  async function save() {
    if (!client) return;
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = "Name is required";
    if (!v.phone.trim() && !v.email.trim()) { e.phone = "Enter a phone number or an email"; e.email = "Enter a phone number or an email"; }
    if (v.phone.trim() && !isPhone10(v.phone)) e.phone = PHONE_MSG;
    if (v.email.trim() && !isEmail(v.email)) e.email = EMAIL_MSG;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await apiClient.post(`/clients/${client.id}/contacts`, { name: v.name.trim(), designation: v.designation.trim() || null, phone: v.phone.trim() || null, email: v.email.trim() || null });
      toast.success("Contact added");
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
    <Sheet open={!!client} title="Add contact" subtitle={client?.name} icon={UserPlus} tone="sky" onClose={onClose}>
      <div className="space-y-4">
        <InputField label="Name" required autoFocus value={v.name} onChange={set("name")} error={errors.name} />
        <InputField label="Designation" value={v.designation} onChange={set("designation")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Phone" required type="tel" value={v.phone} onChange={set("phone")} error={errors.phone} />
          <InputField label="Email" required type="email" value={v.email} onChange={set("email")} error={errors.email} />
        </div>
        <Button onClick={save} loading={busy} className="w-full">Add contact</Button>
      </div>
    </Sheet>
  );
}

/** The client's KAM (sales managers and admins), and the tier if it should not follow revenue. */
export function ManageClientSheet({ client, onClose, onDone }: { client: ClientSummary | null; onClose: () => void; onDone: () => void }) {
  const people = useApi<AssignableUser[]>(client ? "/users/assignable" : null);
  const me = useAppSelector((s) => s.auth.session?.profile);
  const assigns = !!me && isManager(me.role); // assigning clients is for sales managers and admins
  const kams = (people.data ?? []).filter((u) => u.role === "kam");
  const ownerIsKam = kams.some((u) => u.id === client?.owner?.id);
  const [owner, setOwner] = useState("");
  const [tier, setTier] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (client) { setOwner(client.owner?.id ?? ""); setTier(client.tierIsManual ? client.tier : ""); } }, [client]);

  async function save() {
    if (!client) return;
    setBusy(true);
    try {
      await apiClient.patch(`/clients/${client.id}`, { accountOwnerId: assigns && owner !== client.owner?.id ? owner || null : null, tierOverride: tier || null, clearTierOverride: !tier });
      toast.success("Saved");
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!client} title="Manage client" subtitle={client?.name} icon={Settings2} tone="violet" onClose={onClose}>
      <div className="space-y-4">
        {assigns && (
          <>
            <SelectField label="Assigned KAM" placeholder={client?.owner && !ownerIsKam ? `${client.owner.fullName ?? "Current owner"} (not a KAM)` : "Choose a KAM"}
              value={kams.some((u) => u.id === owner) ? owner : ""} options={kams.map((u) => ({ value: u.id, label: u.fullName ?? u.id }))} onChange={(e) => setOwner(e.target.value || client?.owner?.id || "")} />
            <p className="-mt-2 text-xs text-slate-400">Open projects and follow-ups move to the new KAM.</p>
          </>
        )}
        <SelectField label="Tier" placeholder="Automatic (by revenue)" value={tier} options={["A", "B", "C"].map((t) => ({ value: t, label: `Tier ${t}` }))} onChange={(e) => setTier(e.target.value)} />
        <Button onClick={save} loading={busy} className="w-full">Save</Button>
      </div>
    </Sheet>
  );
}
