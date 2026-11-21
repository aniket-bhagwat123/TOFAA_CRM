"use client";
import { Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { ImagePicker } from "@/components/ui/image-picker";
import { Sheet } from "@/components/ui/sheet";
import { uploadPhoto } from "@/features/media/upload";
import { fieldErrors, statusOf } from "@/lib/api-errors";
import { EMAIL_MSG, isEmail, isPhone10, normalizePhone10, PHONE_MSG } from "@/lib/validation";
import { BAND_LABEL } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { Lead, LeadMeta } from "@/types/crm";

type Props = { lead: Lead; meta?: LeadMeta; open: boolean; onClose: () => void; onSaved: () => void };

export function EditLeadSheet({ lead, meta, open, onClose, onSaved }: Props) {
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setPhoto(null);
    setV({
      companyName: lead.company.name, city: lead.company.city ?? "", contactName: lead.contact.name,
      designation: lead.contact.designation ?? "", phone: normalizePhone10(lead.contact.phone) ?? lead.contact.phone ?? "", email: lead.contact.email ?? "",
      source: lead.source ?? "", valueBand: lead.valueBand ?? "", notes: lead.notes ?? "",
    });
  }, [open, lead]);

  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (!(v.companyName ?? "").trim()) e.companyName = "Company name is required";
    if (!(v.contactName ?? "").trim()) e.contactName = "Contact name is required";
    const phone = (v.phone ?? "").trim();
    const email = (v.email ?? "").trim();
    if (!phone && !email) { e.phone = "Enter a phone number or an email"; e.email = "Enter a phone number or an email"; }
    else {
      if (phone && !isPhone10(phone)) e.phone = PHONE_MSG;
      if (email && !isEmail(email)) e.email = EMAIL_MSG;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.trim() === "" ? null : val.trim()]));
      await apiClient.patch(`/leads/${lead.id}`, { ...body, version: lead.version });
      if (photo) {
        try {
          await uploadPhoto(`/leads/${lead.id}/photo`, photo);
        } catch {
          toast.warning("Saved, but the photo could not be uploaded.");
        }
      }
      toast.success("Saved");
      onClose();
      onSaved();
    } catch (e) {
      if (statusOf(e) === 409) { toast.error("Someone else changed this lead. Reloaded the latest."); onClose(); onSaved(); return; }
      const fe = fieldErrors(e);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Edit details" subtitle={lead.company.name} icon={Pencil} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        <ImagePicker label="Photo" name={v.contactName} file={photo} onChange={setPhoto} existingUrl={lead.contact.photoUrl} hint="JPEG, PNG or WebP. Choose a new one to replace it." />
        <InputField label="Company" required placeholder="Enter company name" value={v.companyName ?? ""} onChange={set("companyName")} error={errors.companyName} />
        <InputField label="Contact name" required value={v.contactName ?? ""} onChange={set("contactName")} error={errors.contactName} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Phone" required type="tel" value={v.phone ?? ""} onChange={set("phone")} error={errors.phone} />
          <InputField label="Email" required type="email" value={v.email ?? ""} onChange={set("email")} error={errors.email} />
          <InputField label="Designation" value={v.designation ?? ""} onChange={set("designation")} />
          <InputField label="City" value={v.city ?? ""} onChange={set("city")} />
        </div>
        <SelectField label="Lead source" placeholder="Select" value={v.source ?? ""} onChange={set("source")} options={(meta?.sources ?? []).map((s) => ({ value: s, label: s }))} />
        <SelectField label="Rough value" placeholder="Select" value={v.valueBand ?? ""} onChange={set("valueBand")} options={(meta?.valueBands ?? []).map((b) => ({ value: b, label: BAND_LABEL[b] ?? b }))} />
        <TextareaField label="Notes" value={v.notes ?? ""} onChange={set("notes")} />
        <Button onClick={save} loading={busy} className="w-full">Save</Button>
      </div>
    </Sheet>
  );
}
