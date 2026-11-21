"use client";
import { FileSignature } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DocumentPicker } from "@/components/ui/document-picker";
import { Sheet } from "@/components/ui/sheet";
import { fieldErrors } from "@/lib/api-errors";
import { nextBusinessDayIso } from "@/lib/format";
import { apiClient, errorMessage } from "@/services/api-client";
import { DateChips } from "./date-chips";
import type { LeadTarget } from "./types";

type Props = { target: LeadTarget | null; onClose: () => void; onDone: () => void };

/** Uploading the signed agreement moves the lead to Agreement and Payment. */
export function AgreementSheet({ target, onClose, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [follow, setFollow] = useState(nextBusinessDayIso());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => { if (!target) { setFile(null); setFollow(nextBusinessDayIso()); setErrors({}); } }, [target]);

  async function save() {
    if (!target) return;
    const e: Record<string, string> = {};
    if (!file) e.file = "Attach the signed agreement";
    if (!follow) e.nextFollowUp = "Pick the next follow-up date";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file!);
      form.append("nextFollowUp", follow);
      await apiClient.put(`/leads/${target.leadId}/agreement/signed`, form, { timeout: 60000 });
      toast.success("Signed agreement saved. Moved to Agreement and Payment.");
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
    <Sheet open={!!target} title="Signed agreement" subtitle={target?.name} icon={FileSignature} tone="amber" onClose={onClose}>
      <div className="space-y-4">
        <DocumentPicker label="Signed agreement" required file={file} onChange={(f) => { setFile(f); setErrors((x) => ({ ...x, file: "" })); }} error={errors.file} />
        <DateChips label="Next follow-up" required value={follow} onChange={(d) => { setFollow(d); setErrors((x) => ({ ...x, nextFollowUp: "" })); }} error={errors.nextFollowUp} />
        <Button onClick={save} loading={busy} className="w-full">Save signed agreement</Button>
      </div>
    </Sheet>
  );
}
