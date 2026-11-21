"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { useApi } from "@/hooks/use-api";
import { apiClient, errorMessage } from "@/services/api-client";
import type { QuotationTemplate } from "@/types/crm";

/** The wording on every quotation PDF: an opening line, the terms, a closing line. Prices come from each quotation. */
export function QuotationTemplateTab() {
  const list = useApi<QuotationTemplate[]>("/quotation-templates");
  const current = list.data?.find((t) => t.isDefault) ?? list.data?.[0];
  const [form, setForm] = useState({ name: "", intro: "", terms: "", footer: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (current) setForm({ name: current.name, intro: current.intro ?? "", terms: current.terms ?? "", footer: current.footer ?? "" });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form.name.trim()) return setError("Template name is required");
    setBusy(true);
    try {
      const body = { name: form.name.trim(), intro: form.intro.trim() || null, terms: form.terms.trim() || null, footer: form.footer.trim() || null, isDefault: true };
      if (current) await apiClient.patch(`/quotation-templates/${current.id}`, body);
      else await apiClient.post("/quotation-templates", body);
      toast.success("Template saved");
      void list.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <p className="text-sm text-slate-500">This wording appears on every quotation PDF. The company name and address come from the server settings (COMPANY_NAME, COMPANY_ADDRESS).</p>
      <InputField label="Template name" required value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setError(undefined); }} error={error} />
      <TextareaField label="Opening line" value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} placeholder="Write the opening line" />
      <TextareaField label="Terms" rows={5} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} placeholder="Write the terms, one per line" />
      <InputField label="Closing line" value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} placeholder="Write the closing line" />
      <Button onClick={save} loading={busy}>Save template</Button>
    </Card>
  );
}
