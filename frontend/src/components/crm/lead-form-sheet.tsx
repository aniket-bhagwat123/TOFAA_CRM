"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ImagePicker } from "@/components/ui/image-picker";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { leadSchema, type LeadValues } from "@/features/forms/schemas";
import { uploadPhoto } from "@/features/media/upload";
import { useApi } from "@/hooks/use-api";
import { useDebounce } from "@/hooks/use-debounce";
import { errorData, fieldErrors, statusOf } from "@/lib/api-errors";
import { BAND_LABEL } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import type { DuplicateMatch, Lead, LeadMeta } from "@/types/crm";
import { DuplicateBanner } from "./duplicate-banner";

type Props = { open: boolean; onClose: () => void; onCreated?: () => void };

/** Add a lead from a side panel. Company, contact name and a phone or email are required; everything else is optional. */
export function LeadFormSheet({ open, onClose, onCreated }: Props) {
  const router = useRouter();
  const meta = useApi<LeadMeta>(open ? "/leads/meta" : null);
  const [more, setMore] = useState(false);
  const [dups, setDups] = useState<DuplicateMatch[]>([]);
  const [useExisting, setUseExisting] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const { register, handleSubmit, watch, setError, reset, formState: { errors, isSubmitting } } = useForm<LeadValues>({ resolver: zodResolver(leadSchema) });

  const company = useDebounce(watch("companyName") ?? "", 500);
  const phone = useDebounce(watch("phone") ?? "", 500);
  const email = useDebounce(watch("email") ?? "", 500);
  const contactName = watch("contactName");

  useEffect(() => {
    if (open) return;
    reset(); setDups([]); setUseExisting(false); setPhoto(null); setMore(false);
  }, [open, reset]);

  // Live duplicate check: the executive sees "already exists" before finishing the form.
  useEffect(() => {
    if (!open) return;
    if (company.trim().length < 3 && phone.trim().length < 7 && !email.includes("@")) { setDups([]); return; }
    let cancelled = false;
    apiClient
      .post<DuplicateMatch[]>("/leads/check-duplicates", { companyName: company || null, phone: phone || null, email: email || null })
      .then((r) => !cancelled && setDups(r.data))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, company, phone, email]);

  const onlyCompany = dups.length > 0 && dups.every((d) => d.matchedOn.length === 1 && d.matchedOn[0] === "company");
  const blocked = dups.length > 0 && !(onlyCompany && useExisting);

  const onSubmit = handleSubmit(async (values) => {
    if (blocked) return toast.error("This lead already exists. Open it instead.");
    try {
      const body = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === "" ? null : v]));
      const res = await apiClient.post<Lead>("/leads", { ...body, useExistingCompany: useExisting });
      if (photo) {
        try {
          await uploadPhoto(`/leads/${res.data.id}/photo`, photo);
        } catch {
          toast.warning("Lead added, but the photo could not be uploaded. Add it from the lead.");
        }
      }
      toast.success("Lead added. First follow-up is set for the next business day.");
      onClose();
      onCreated?.();
      router.push(`/leads/${res.data.id}`);
    } catch (e) {
      if (statusOf(e) === 409) setDups(errorData<{ duplicates: DuplicateMatch[] }>(e)?.duplicates ?? []);
      else {
        const fe = fieldErrors(e);
        Object.entries(fe).forEach(([k, m]) => setError(k as keyof LeadValues, { message: m }));
        if (!Object.keys(fe).length) toast.error(errorMessage(e));
      }
    }
  });

  return (
    <Sheet open={open} title="Add lead" subtitle="Company, contact and a phone or email" icon={UserPlus} tone="violet" onClose={onClose} width="lg">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <ImagePicker label="Photo" name={contactName} file={photo} onChange={setPhoto} hint="The client or their logo. JPEG, PNG or WebP. Optional." />
        <InputField label="Company" required autoFocus placeholder="Enter company name" autoComplete="off" error={errors.companyName?.message} {...register("companyName")} />
        <InputField label="Contact name" required autoComplete="off" error={errors.contactName?.message} {...register("contactName")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField label="Phone" required type="tel" inputMode="tel" error={errors.phone?.message} {...register("phone")} />
          <InputField label="Email" required type="email" error={errors.email?.message} {...register("email")} />
        </div>
        <p className="-mt-2 text-xs text-slate-500">Phone and email are both marked because at least one of them is needed.</p>

        <DuplicateBanner matches={dups}>
          {onlyCompany && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={useExisting} onChange={(e) => setUseExisting(e.target.checked)} className="accent-violet-600" />
              This is a different person at the same company. Add them as a new lead.
            </label>
          )}
        </DuplicateBanner>


        <button type="button" onClick={() => setMore((m) => !m)} className="text-sm font-medium text-brand">
          {more ? "Hide details" : "More details (optional)"}
        </button>
        {more && (
          <div className="space-y-4">
            <SelectField label="Lead source" placeholder="Select" options={(meta.data?.sources ?? []).map((s) => ({ value: s, label: s }))} {...register("source")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label="Designation" {...register("designation")} />
              <InputField label="City" {...register("city")} />
            </div>
            <SelectField label="Rough value" placeholder="Select" options={(meta.data?.valueBands ?? []).map((b) => ({ value: b, label: BAND_LABEL[b] ?? b }))} {...register("valueBand")} />
            <TextareaField label="Notes" {...register("notes")} />
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button type="submit" loading={isSubmitting} className="flex-1">Add lead</Button>
        </div>
      </form>
    </Sheet>
  );
}
