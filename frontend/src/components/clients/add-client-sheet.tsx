"use client";
import { Building2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Sheet } from "@/components/ui/sheet";
import { errorData, fieldErrors, statusOf } from "@/lib/api-errors";
import { EMAIL_MSG, isEmail, isPhone10, PHONE_MSG } from "@/lib/validation";
import { apiClient, errorMessage } from "@/services/api-client";

type Props = { open: boolean; onClose: () => void; onDone: (id: string) => void };
const EMPTY = { companyName: "", contactName: "", phone: "", email: "", designation: "", city: "" };

/** Add a customer you already work with (clients normally appear by themselves when a deal is paid). */
export function AddClientSheet({ open, onClose, onDone }: Props) {
  const [v, setV] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState<{ companyId: string; isClient: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: "" })); };

  useEffect(() => { if (!open) { setV(EMPTY); setErrors({}); setExisting(null); } }, [open]);

  async function save() {
    const e: Record<string, string> = {};
    if (!v.companyName.trim()) e.companyName = "Company name is required";
    if (!v.contactName.trim()) e.contactName = "Contact name is required";
    if (!v.phone.trim() && !v.email.trim()) { e.phone = "Enter a phone number or an email"; e.email = "Enter a phone number or an email"; }
    if (v.phone.trim() && !isPhone10(v.phone)) e.phone = PHONE_MSG;
    if (v.email.trim() && !isEmail(v.email)) e.email = EMAIL_MSG;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim() || null]));
      const res = await apiClient.post<{ id: string }>("/clients", body);
      toast.success("Client added");
      onClose();
      onDone(res.data.id);
    } catch (err) {
      if (statusOf(err) === 409) setExisting(errorData<{ companyId: string; isClient: boolean }>(err) ?? null);
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe);
      else if (statusOf(err) !== 409) toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!existing) return;
    setBusy(true);
    try {
      const res = await apiClient.post<{ id: string }>("/clients", { companyId: existing.companyId });
      toast.success("Now a client");
      onClose();
      onDone(res.data.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Add client" subtitle="A customer you already work with" icon={Building2} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        {existing && (
          <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">This company is already in the CRM.</p>
            {existing.isClient ? (
              <Link href={`/clients/${existing.companyId}`} className="font-semibold underline">Open the client</Link>
            ) : (
              <Button variant="secondary" className="min-h-8 px-3 py-1 text-xs" loading={busy} onClick={convert}>Make it a client</Button>
            )}
          </div>
        )}
        <InputField label="Company" required autoFocus placeholder="Enter company name" value={v.companyName} onChange={set("companyName")} error={errors.companyName} />
        <InputField label="Contact name" required value={v.contactName} onChange={set("contactName")} error={errors.contactName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Phone" required type="tel" value={v.phone} onChange={set("phone")} error={errors.phone} />
          <InputField label="Email" required type="email" value={v.email} onChange={set("email")} error={errors.email} />
          <InputField label="Designation" value={v.designation} onChange={set("designation")} />
          <InputField label="City" value={v.city} onChange={set("city")} />
        </div>
        <p className="-mt-2 text-xs text-slate-500">Phone and email are both marked because at least one of them is needed.</p>
        <Button onClick={save} loading={busy} className="w-full">Add client</Button>
      </div>
    </Sheet>
  );
}
